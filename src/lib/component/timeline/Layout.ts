import { MMedia } from "../../API";
import { AudioSampler } from "../../AudioSampler";
import { CanvasManager } from "../../CanvasManager";
import { SubtitleEntry, type SubtitleStyle } from "../../core/Subtitles.svelte";
import { ChangeType, Source } from "../../frontend/Source";
import { Debug } from "../../Debug";
import { Playback } from "../../frontend/Playback";
import { DebugConfig, InterfaceConfig } from "../../config/Groups";
import { get } from "svelte/store";
import { TimelineConfig } from "./Config";
import { EventHost } from "../../frontend/Frontend";
import { Editing } from "../../frontend/Editing";

const PRELOAD_MARGIN = 3;
const PRELOAD_MARGIN_FACTOR = 0.1;
const CURSOR_SAFE_AREA_RIGHT_MARGIN = 50;

export type Box = {
  x: number, y: number,
  w: number, h: number
};

export class TimelineLayout {
  static readonly HEADER_HEIGHT = 15;
  static readonly TRACKS_PADDING = 15;
  static readonly LEFT_COLUMN_MARGIN = 5;

  readonly manager: CanvasManager;

  requestedSampler = false;
  requestedLayout = false;
  sampler: AudioSampler | null = null;
  #samplerMedia: MMedia | undefined;

  onLayout = new EventHost();

  /** pixels per second */
  #scale = 1;
  width = 100; height = 100;
  entryHeight = 0;
  leftColumnWidth = 100;

  #shownStyles: SubtitleStyle[] = [];
  #stylesMap = new Map<SubtitleStyle, number>();

  constructor(
    public readonly canvas: HTMLCanvasElement
  ) {
    this.manager = new CanvasManager(canvas);
    this.manager.onDisplaySizeChanged.bind(this, 
      (w, h) => this.#processDisplaySizeChanged(w, h));
    this.setScale(10);

    Playback.onLoad.bind(this, async (rawurl) => {
      Debug.assert(this.#samplerMedia === undefined || this.#samplerMedia.isClosed)
      if (DebugConfig.data.disableWaveform) return;
    
      this.#samplerMedia = await MMedia.open(rawurl);
      this.sampler = await AudioSampler.open(
        this.#samplerMedia, TimelineConfig.data.waveformResolution);
      this.sampler.onProgress = () => this.manager.requestRender();
      this.setScale(Math.max(this.width / this.sampler.duration, 10));
      this.setOffset(0);
      Playback.setPosition(0);
      this.requestedSampler = true;
      this.manager.requestRender();
    });

    Playback.onClose.bind(this, async () => {
      if (this.sampler == undefined)
        return Debug.early('already closed');
      Debug.assert(this.#samplerMedia !== undefined && !this.#samplerMedia.isClosed);
      await Debug.info('closing timeline');
      await this.sampler.close();
      this.#samplerMedia = undefined;
      this.sampler = null;
      Playback.setPosition(0);
      this.manager.requestRender();
      await Debug.info('closed timeline');
    });

    Playback.onPositionChanged.bind(this, (pos) => {
      if (!get(Playback.isLoaded)) {
        const originalPos = pos;
        if (pos < 0) pos = 0;
        pos = Math.min(pos, this.maxPosition);
        if (pos != originalPos) {
          Playback.setPosition(pos);
          return;
        }
      }
      this.keepPosInSafeArea(pos);
      this.manager.requestRender();
    });

    Source.onSubtitlesChanged.bind(this, (type) => {
      if (type == ChangeType.StyleDefinitions || type == ChangeType.General)
        this.requestedLayout = true;
      if (type == ChangeType.Times || type == ChangeType.General)
        this.#updateContentArea();
      if (type != ChangeType.Metadata)
        this.manager.requestRender();
    });
    Source.onSubtitleObjectReload.bind(this, () => {
      this.#updateContentArea();
      this.requestedLayout = true;
      this.manager.requestRender();
    });
  }

  // TODO: cache it
  get maxPosition() {
    return this.sampler 
      ? this.sampler.duration 
      : Math.max(0, ...Source.subs.entries.map((x) => x.end)) + 20;
  }

  get scale() {
    return this.#scale;
  }
  
  get offset() {
    return this.manager.scroll[0] / this.scale;
  }

  get shownStyles(): readonly SubtitleStyle[] {
    return this.#shownStyles;
  }

  setScale(v: number) {
    Debug.assert(v > 0);
    v = Math.max(v, this.width / this.maxPosition, 0.15);
    v = Math.min(v, 500);
    if (v == this.scale) return;
    this.#scale = v;
    this.#updateContentArea();
    this.manager.requestRender();
    this.requestedSampler = true;
  }

  setOffset(v: number) {
    if (v < 0) v = 0;
    v = Math.min(v, this.maxPosition - this.width / this.scale);
    this.manager.setScroll({x: v * this.scale});
    this.manager.requestRender();
    this.requestedSampler = true;
  }

  getVisibleEntries(): SubtitleEntry[] {
    const end = this.offset + this.width / this.scale;
    return Source.subs.entries.filter(
      (ent) => ent.end > this.offset && ent.start < end);
  }

  getHorizontalPos(ent: SubtitleEntry, opt?: {local?: boolean}): [w: number, x: number] {
    return [
      (ent.end - ent.start) * this.scale,
      (ent.start - (opt?.local ? this.offset : 0)) * this.scale + this.leftColumnWidth
    ];
  }

  getEntryPositions(ent: SubtitleEntry): (Box & {text: string})[] {
    const [w, x] = this.getHorizontalPos(ent);
    return [...ent.texts.entries()].flatMap(([style, text]) => {
      if (Source.subs.view.timelineExcludeStyles.has(style)) return [];
      const i = this.#stylesMap.get(style) ?? 0;
      const y = this.entryHeight * i 
        + TimelineLayout.HEADER_HEIGHT + TimelineLayout.TRACKS_PADDING;
      return [{x: x, y: y, w: w, h: this.entryHeight, text}];
    });
  }

  findEntriesByPosition(
    x: number, y: number, w = 0, h = 0): SubtitleEntry[] 
  {
    let result = [];
    const start = (x - this.leftColumnWidth) / this.scale;
    const end = (x - this.leftColumnWidth + w) / this.scale;
    for (let ent of Source.subs.entries) {
      if (ent.end < start || ent.start > end) continue;
      if (this.getEntryPositions(ent)
        .some((b) => b.x <= x + w && b.x + b.w >= x 
                  && b.y <= y + h && b.y + b.h >= y)) result.push(ent);
    }
    return result;
  }

  keepEntryInView(ent: SubtitleEntry) {
    const [w, x] = this.getHorizontalPos(ent, {local: true});
    const dxStart = x;
    const dxEnd = (x + w) - this.width;
    if (dxStart >= 0 && dxEnd <= 0) return;
    if (Math.abs(dxStart) < Math.abs(dxEnd))
      this.setOffset(this.offset + dxStart / this.scale);
    else
      this.setOffset(this.offset + dxEnd / this.scale);
  }

  keepPosInSafeArea(pos: number) {
    const marginL = this.leftColumnWidth / this.#scale;
    const marginR = CURSOR_SAFE_AREA_RIGHT_MARGIN / this.#scale;
    const left = this.offset,
         right = this.offset + this.width / this.#scale - marginR;
    if (pos < left)  this.setOffset(this.offset + pos - left);
    if (pos > right) this.setOffset(this.offset + pos - right);
  }

  layout(ctx: CanvasRenderingContext2D) {
    this.requestedLayout = false;
    const subs = Source.subs;
    const exclude = subs.view.timelineExcludeStyles;
    for (const s of [...exclude])
      if (!subs.styles.includes(s))
      exclude.delete(s);
    if (exclude.size == subs.styles.length)
      exclude.clear();
    // styleRefreshCounter++;
    
    this.#shownStyles = subs.styles.filter((x) => !exclude.has(x));
    this.entryHeight = TimelineConfig.data.fontSize + 15;
    this.#stylesMap = new Map(this.#shownStyles.map((x, i) => [x, i]));

    if (Editing.activeChannel && !this.#shownStyles.includes(Editing.activeChannel))
        Editing.activeChannel = null;

    ctx.font = `${TimelineConfig.data.fontSize}px ${InterfaceConfig.data.fontFamily}`;
    this.leftColumnWidth =
      Math.max(30, ...this.#shownStyles.map((x) => ctx.measureText(x.name).width))
      + TimelineLayout.LEFT_COLUMN_MARGIN * 2;

    this.manager.requestRender();
    this.onLayout.dispatch();
  }

  #updateContentArea() {
    this.manager.setContentRect({ 
      r: this.maxPosition * this.scale,
      b: this.entryHeight * this.#shownStyles.length 
          + TimelineLayout.TRACKS_PADDING * 2 
          + TimelineLayout.HEADER_HEIGHT
    });
  }

  #processDisplaySizeChanged(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.requestedLayout = true;
    this.#updateContentArea();
    this.#setViewOffset(this.offset);
    this.manager.requestRender();
  }

  #setViewOffset(v: number) {
    if (v < 0) v = 0;
    v = Math.min(v, this.maxPosition - this.width / this.scale);
    this.manager.setScroll({x: v * this.scale});
    this.manager.requestRender();
    this.requestedSampler = true;
  }

  processSampler() {
    if (!this.sampler) return;
  
    let start = this.offset;
    let end = this.offset + this.width / this.scale;
    const preload = Math.min(PRELOAD_MARGIN, (end - start) * PRELOAD_MARGIN_FACTOR);
    if (this.sampler.isSampling) {
      if (this.sampler.sampleProgress + preload < this.offset 
       || this.sampler.sampleProgress > end + preload) 
        this.sampler.tryCancelSampling();
      else if (this.sampler.sampleEnd < end + preload) {
        this.sampler.extendSampling(end + preload);
      }
    }
    if (this.sampler.isSampling)
      return;
  
    const resolution = this.sampler.resolution;
    const i = Math.floor(this.offset * resolution),
          i_end = Math.ceil(end * resolution);
    const subarray = this.sampler.detail.subarray(i, i_end);
    const first0 = subarray.findIndex((x) => x == 0);
    if (Playback.isPlaying) {
      if (first0 < 0) {
        this.requestedSampler = false;
        return;
      }
    } else {
      this.requestedSampler = false;
      if (first0 < 0) return;
    }
    start = (first0 + i) / resolution;
    let end0 = subarray.findIndex((x, i) => i > first0 && x > 0);
    if (end0 > 0) end = (end0 + i) / resolution;
  
    end += preload;
    if (start < 0) start = 0;
    if (end > this.sampler.duration) end = this.sampler.duration;
    if (end <= start) {
      Debug.debug(start, '>=', end);
      return;
    }
  
    this.sampler.startSampling(start, end);
    this.manager.requestRender();
  }
}
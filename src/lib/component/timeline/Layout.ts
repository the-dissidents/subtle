import { MMedia } from "../../API";
import { CanvasManager } from "../../CanvasManager";
import { SubtitleEntry, type SubtitleStyle } from "../../core/Subtitles.svelte";
import { ChangeType, Source } from "../../frontend/Source";
import { Debug } from "../../Debug";
import { Playback } from "../../frontend/Playback";
import { DebugConfig, InterfaceConfig } from "../../config/Groups";
import { TimelineConfig } from "./Config";
import { EventHost } from "../../details/EventHost";
import { MediaSampler2 } from "./MediaSampler2";
import { TimelineParams } from "./Input.svelte";

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
  #samplerMedia: MMedia | undefined;

  onLayout = new EventHost();

  /** pixels per second */
  #scale = 1;
  width = 100; height = 100;
  entryHeight = 0;
  leftColumnWidth = 100;
  #previousPos = 0;

  #shownStyles: SubtitleStyle[] = [];
  #stylesMap = new Map<SubtitleStyle, number>();

  async #makeSampler(audio: number) {
    Debug.assert(this.#samplerMedia !== undefined);
    const sampler = await MediaSampler2.open(
      this.#samplerMedia, audio, 
      TimelineConfig.data.waveformResolution);
    sampler.onProgress = () => this.manager.requestRender();
    this.requestedSampler = true;
    this.manager.requestRender();
    return sampler;
  }

  constructor(public readonly canvas: HTMLCanvasElement) {
    this.manager = new CanvasManager(canvas);
    this.manager.onDisplaySizeChanged.bind(this, 
      (w, h) => this.#processDisplaySizeChanged(w, h));
    this.setScale(10);

    Playback.onLoad.bind(this, async (rawurl, audio) => {
      Debug.assert(this.#samplerMedia === undefined || this.#samplerMedia.isClosed)
      if (DebugConfig.data.disableWaveform) return;
    
      this.#samplerMedia = await MMedia.open(rawurl);
      try {
        Playback.sampler = await this.#makeSampler(audio);
      } catch (e) {
        await this.#samplerMedia.close();
        this.#samplerMedia = undefined;
      }
    });

    Playback.onLoaded.bind(this, () => {
      this.setScale(Math.max(this.width / Playback.duration, 10));
      this.setOffset(0);
      Playback.setPosition(0);
      this.requestedSampler = true;
      this.manager.requestRender();
    })

    Playback.onClose.bind(this, async () => {
      if (Playback.sampler == undefined)
        return Debug.early('already closed');
      Debug.assert(this.#samplerMedia !== undefined && !this.#samplerMedia.isClosed);
      await Debug.info('closing timeline');
      await Playback.sampler.close();
      this.#samplerMedia = undefined;
      Playback.sampler = null;
      Playback.setPosition(0);
      this.manager.requestRender();
      await Debug.info('closed timeline');
    });

    Playback.onPositionChanged.bind(this, (pos) => {
      if (!Playback.player) {
        const originalPos = pos;
        if (pos < 0) pos = 0;
        pos = Math.min(pos, this.maxPosition);
        if (pos != originalPos) {
          Playback.setPosition(pos);
          return;
        }
      } else if (!this.keepPosInSafeArea(pos) 
               && Playback.isPlaying && TimelineParams.lockCursor.get()) {
        this.setOffset(this.offset + (pos - this.#previousPos));
      }
      this.#previousPos = pos;
      this.manager.requestRender();
    });

    Playback.onSetAudioStream.bind(this, async (id) => {
      const sampler = await this.#makeSampler(id);
      Playback.sampler = sampler;
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
    return Playback.sampler 
      ? Playback.duration 
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

  getEntryPositions(ent: SubtitleEntry): (Box & {text: string, style: SubtitleStyle})[] {
    const [w, x] = this.getHorizontalPos(ent);
    return [...ent.texts.entries()].flatMap(([style, text]) => {
      if (Source.subs.view.timelineExcludeStyles.has(style)) return [];
      const i = this.#stylesMap.get(style) ?? 0;
      const y = this.entryHeight * i 
        + TimelineLayout.HEADER_HEIGHT + TimelineLayout.TRACKS_PADDING;
      return [{x: x, y: y, w: w, h: this.entryHeight, text, style}];
    });
  }

  getChannelFromY(y: number, clamp = false): SubtitleStyle | undefined {
    let i = Math.floor((y + this.manager.scroll[1] 
      - TimelineLayout.HEADER_HEIGHT - TimelineLayout.TRACKS_PADDING) / this.entryHeight);
    if (clamp) return this.#shownStyles[Math.min(Math.max(i, this.shownStyles.length - 1), 0)];
    return this.#shownStyles.at(i);
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
    const left = Math.max(0, this.offset + CURSOR_SAFE_AREA_RIGHT_MARGIN / this.#scale),
         right = this.offset + (this.width 
            - CURSOR_SAFE_AREA_RIGHT_MARGIN - this.leftColumnWidth) / this.#scale;
    if (pos < left) {
      this.setOffset(this.offset + pos - left);
      return true;
    }
    if (pos > right) {
      this.setOffset(this.offset + pos - right);
      return true;
    }
    return false;
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

  async processSampler() {
    if (!Playback.sampler) return;
  
    let start = this.offset;
    let end = this.offset + this.width / this.scale;
    const preload = Math.min(PRELOAD_MARGIN, (end - start) * PRELOAD_MARGIN_FACTOR);
    if (Playback.sampler.isSampling) {
      if (Playback.sampler.sampleProgress > Playback.sampler.sampleStart
       && (Playback.sampler.sampleProgress + preload < this.offset 
        || Playback.sampler.sampleProgress > end + preload))
      {
        Playback.sampler.tryCancelSampling();
      } else if (Playback.sampler.sampleEnd < end + preload) {
        Playback.sampler.extendSampling(end + preload);
      }
      return;
    }
  
    const resolution = Playback.sampler.intensityResolution;
    const i = Math.floor(this.offset * resolution),
          i_end = Math.ceil(end * resolution);
    const subarray = Playback.sampler.intensityData(1, i, i_end);
    const gapStart = subarray.findIndex(
      // FIXME: the following is a desperate but seeming effective hack to get the sampler working 
      // despite those one-frame gaps popping up; it's definitely not serious
      (x, i) => i < subarray.length - 1 && isNaN(x) && isNaN(subarray[i+1]));
    if (Playback.isPlaying) {
      if (gapStart < 0) {
        this.requestedSampler = false;
        return;
      }
    } else {
      this.requestedSampler = false;
      if (gapStart < 0) return;
    }
    start = (gapStart + i) / resolution;
    const gapEnd = subarray.findIndex((x, i) => i > gapStart && !isNaN(x));
    if (gapEnd > 0) end = (gapEnd + i) / resolution;
  
    end += preload;
    if (start < 0) start = 0;
    if (end > Playback.duration) end = Playback.duration;
    if (end <= start) {
      Debug.debug(start, '>=', end);
      return;
    }
  
    Playback.sampler.startSampling(start, end);
    this.manager.requestRender();
  }
}
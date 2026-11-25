import { MMedia } from "../../API";
import { CanvasManager } from "../../CanvasManager";
import { SubtitleEntry, type SubtitleStyle } from "../../core/Subtitles.svelte";
import { ChangeType, Source } from "../../frontend/Source";
import { Debug } from "../../Debug";
import { Playback } from "../../frontend/Playback";
import { DebugConfig, InterfaceConfig } from "../../config/Groups";
import { TimelineConfig } from "./Config";
import { EventHost } from "@the_dissidents/svelte-ui";
import { MediaSampler } from "./MediaSampler";
import { TimelineHandle } from "./Input.svelte";
import { get } from "svelte/store";
import { RichText } from "../../core/RichText";

const PRELOAD_MARGIN = 10;
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
  #sortedEntries: { entry: SubtitleEntry, index: number }[] = [];
  #prefixMaxEnd: number[] = [];
  #cachedMaxEnd = 0;
  #entriesIndexDirty = true;
  #samplerTimer: ReturnType<typeof setTimeout> | null = null;

  async #makeSampler(audio: number) {
    Debug.assert(this.#samplerMedia !== undefined);
    const sampler = await MediaSampler.open(
      this.#samplerMedia, audio,
      TimelineConfig.data.waveformResolution);
    sampler.onProgress = () => this.manager.requestRender();
    sampler.onComplete = () => {
      this.requestedSampler = true;
      this.scheduleSampler(0);
    };
    this.requestedSampler = true;
    this.manager.requestRender();
    return sampler;
  }

  constructor(public readonly canvas: HTMLCanvasElement) {
    this.manager = new CanvasManager(canvas);
    this.manager.onDisplaySizeChanged.bind(this,
      (w, h) => this.#processDisplaySizeChanged(w, h));

    Playback.onLoad.bind(this, async (rawurl, audio) => {
      Debug.assert(this.#samplerMedia === undefined || this.#samplerMedia.isClosed)
      if (DebugConfig.data.disableWaveform) return;

      this.#samplerMedia = await MMedia.open(rawurl);
      try {
        Playback.sampler = await this.#makeSampler(audio);
      } catch (e) {
        await Playback.sampler?.close();
        if (!this.#samplerMedia.isClosed)
            await this.#samplerMedia.close();
        this.#samplerMedia = undefined;
        await Debug.forwardError(e);
      }
    });

    Playback.onLoaded.bind(this, () => {
      // Playback.setPosition(0);
      this.requestedSampler = true;
      this.manager.requestRender();
    })

    Playback.onClose.bind(this, async () => {
      if (Playback.sampler == undefined)
        return Debug.early();
      Debug.assert(this.#samplerMedia !== undefined && !this.#samplerMedia.isClosed);
      await Debug.info('closing timeline');
      await Playback.sampler.close();
      this.#samplerMedia = undefined;
      Playback.sampler = null;
      await Playback.setPosition(0);
      this.manager.requestRender();
      await Debug.info('closed timeline');
    });

    Playback.onPositionChanged.bind(this, async (pos) => {
      if (!Playback.player) {
        const originalPos = pos;
        if (pos < 0) pos = 0;
        pos = Math.max(pos, this.minPosition);
        pos = Math.min(pos, this.maxPosition);
        if (pos != originalPos) {
          await Playback.setPosition(pos);
          return;
        }
      } else if (Playback.isPlaying) {
        const moved = await this.keepPosInSafeArea(pos);
        if (!moved && TimelineHandle.lockCursor.get())
          await this.setOffset(this.offset + (pos - this.#previousPos));
      }
      this.#previousPos = pos;
      this.manager.requestRender();
    });

    Playback.onSetAudioStream.bind(this, async (id) => {
      const sampler = await this.#makeSampler(id);
      Playback.sampler = sampler;
    });

    Source.onSubtitlesChanged.bind(this, async (type) => {
      if (type == ChangeType.StyleDefinitions || type == ChangeType.General)
        this.requestedLayout = true;
      if (type == ChangeType.Times || type == ChangeType.General || type == ChangeType.Order)
        this.#entriesIndexDirty = true;
      if (type == ChangeType.Times || type == ChangeType.General)
        await this.#updateContentArea();
      if (type != ChangeType.Metadata)
        this.manager.requestRender();
    });

    Source.onSubtitleViewChanged.bind(this, () => {
        this.manager.requestRender();
    });

    Source.onSubtitleObjectReload.bind(this, (newFile) => {
      this.requestedLayout = true;
      this.#entriesIndexDirty = true;
      this.manager.requestRender();

      const state = Source.subs.metadata.uiState;
      if (!state || !newFile) return;

      const callback = async () => {
        if (state.timelineScale !== null && state.timelineOffset !== null) {
          await this.setScale(state.timelineScale);
          await this.setOffset(state.timelineOffset);
        } else {
          await this.setScale(10);
          await this.setOffset(0);
        }
      }
      requestAnimationFrame(() => {
        if (get(Playback.loadState) == 'loading')
          Playback.onLoaded.bind(this, callback, {once: true});
        else void callback();
      });
    });
    Source.onSubtitleWillSave.bind(this, () => {
      Source.subs.metadata.uiState.timelineOffset = this.offset;
      Source.subs.metadata.uiState.timelineScale = this.scale;
    });
  }

  #ensureEntryIndex() {
    const entries = Source.subs.entries;
    if (!this.#entriesIndexDirty && this.#sortedEntries.length === entries.length) return;
    this.#entriesIndexDirty = false;
    this.#sortedEntries = entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.start - b.entry.start);
    this.#prefixMaxEnd = new Array<number>(this.#sortedEntries.length);
    let maxEnd = -Infinity;
    for (let i = 0; i < this.#sortedEntries.length; i++) {
      maxEnd = Math.max(maxEnd, this.#sortedEntries[i].entry.end);
      this.#prefixMaxEnd[i] = maxEnd;
    }
    this.#cachedMaxEnd = maxEnd > 0 ? maxEnd : 0;
  }

  get maxPosition() {
    if (Playback.loaded && Playback.player !== null)
      return Playback.player.endTime + 20;
    this.#ensureEntryIndex();
    return this.#cachedMaxEnd + 20;
  }

  get minPosition() {
    return Playback.player !== null
      ? Playback.player.startTime
      : 0;
  }

  get positionSpan() {
    return this.maxPosition - this.minPosition;
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

  async setScale(v: number) {
    Debug.assert(v > 0);
    v = Math.max(v, this.width / this.positionSpan, 0.15);
    v = Math.min(v, 500);
    if (v == this.scale) return;

    this.#scale = v;
    await this.#updateContentArea();
    this.manager.requestRender();
    this.requestedSampler = true;
  }

  async setOffset(seconds: number) {
    if (seconds < 0) seconds = 0;

    seconds = Math.max(seconds, this.minPosition);
    seconds = Math.min(seconds, this.maxPosition - this.width / this.scale);
    await this.manager.setScroll({x: seconds * this.scale});
    this.manager.requestRender();
    this.requestedSampler = true;
  }

  getVisibleEntries(): SubtitleEntry[] {
    const offset = this.offset;
    const end = offset + this.width / this.scale;
    if (TimelineHandle.isDuringAction()) {
      return Source.subs.entries.filter(
        (ent) => ent.end > offset && ent.start < end);
    }

    this.#ensureEntryIndex();
    const sorted = this.#sortedEntries;
    const n = sorted.length;
    if (n === 0) return [];

    // binary search for last entry with start < end
    let lo = 0, hi = n - 1, right = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid].entry.start < end) {
        right = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (right < 0) return [];

    const visible: { entry: SubtitleEntry, index: number }[] = [];
    for (let i = right; i >= 0; i--) {
      if (this.#prefixMaxEnd[i] <= offset) break;
      const item = sorted[i];
      if (item.entry.end > offset)
        visible.push(item);
    }
    visible.sort((a, b) => a.index - b.index);
    return visible.map((x) => x.entry);
  }

  getHorizontalPos(ent: SubtitleEntry, opt?: {local?: boolean}): [w: number, x: number] {
    return [
      (ent.end - ent.start) * this.scale,
      (ent.start - (opt?.local ? this.offset : 0)) * this.scale + this.leftColumnWidth
    ];
  }

  getEntryPositions(ent: SubtitleEntry): (Box & {text: string, style: SubtitleStyle})[] {
    const [w, x] = this.getHorizontalPos(ent);
    const result: (Box & {text: string, style: SubtitleStyle})[] = [];
    for (const [style, text] of ent.texts) {
      const i = this.#stylesMap.get(style);
      if (i === undefined) continue;
      const y = this.entryHeight * i
        + TimelineLayout.HEADER_HEIGHT + TimelineLayout.TRACKS_PADDING;
      result.push({x, y, w, h: this.entryHeight, text: RichText.toString(text), style});
    }
    return result;
  }

  getChannelFromOffsetY(y: number, clamp = false): SubtitleStyle | undefined {
    const i = Math.floor(
      (y + this.manager.scroll[1] - TimelineLayout.HEADER_HEIGHT - TimelineLayout.TRACKS_PADDING)
      / this.entryHeight);
    if (clamp) return this.#shownStyles[Math.min(Math.max(i, this.shownStyles.length - 1), 0)];
    if (i < 0) return undefined;
    return this.#shownStyles.at(i);
  }

  findEntriesByPosition(
    x: number, y: number, w = 0, h = 0
  ): SubtitleEntry[] {
    const result = [];
    const start = (x - this.leftColumnWidth) / this.scale;
    const end = (x - this.leftColumnWidth + w) / this.scale;
    for (const ent of Source.subs.entries) {
      if (ent.end < start || ent.start > end) continue;
      if (this.getEntryPositions(ent)
        .some((b) => b.x <= x + w && b.x + b.w >= x
                  && b.y <= y + h && b.y + b.h >= y)) result.push(ent);
    }
    return result;
  }

  async keepEntryInView(ent: SubtitleEntry) {
    const [w, x] = this.getHorizontalPos(ent, {local: true});
    const dxStart = x;
    const dxEnd = (x + w) - this.width;
    if (dxStart >= this.leftColumnWidth && dxEnd <= 0) return;
    if (Math.abs(dxStart) < Math.abs(dxEnd))
      await this.setOffset(this.offset + (dxStart - this.leftColumnWidth) / this.scale);
    else
      await this.setOffset(this.offset + dxEnd / this.scale);
  }

  async keepPosInSafeArea(pos: number) {
    const left = Math.max(0, this.offset + CURSOR_SAFE_AREA_RIGHT_MARGIN / this.#scale),
         right = this.offset + (this.width
            - CURSOR_SAFE_AREA_RIGHT_MARGIN - this.leftColumnWidth) / this.#scale;
    if (pos < left) {
      await this.setOffset(this.offset + pos - left);
      return true;
    }
    if (pos > right) {
      await this.setOffset(this.offset + pos - right);
      return true;
    }
    return false;
  }

  async layout(ctx: CanvasRenderingContext2D) {
    this.requestedLayout = false;
    const subs = Source.subs;
    this.#shownStyles = subs.styles.filter((x) =>
        !subs.view.timelineExcludeStyles.has(x) && (subs.view.timelineShowHidden || !x.hidden));

    this.entryHeight = TimelineConfig.data.fontSize + 15;
    this.#stylesMap = new Map(this.#shownStyles.map((x, i) => [x, i]));

    ctx.font = `${TimelineConfig.data.fontSize}px ${InterfaceConfig.data.fontFamily}`;
    this.leftColumnWidth =
      Math.max(30, ...this.#shownStyles.map((x) => ctx.measureText(x.name).width))
      + TimelineLayout.LEFT_COLUMN_MARGIN * 2;

    this.manager.requestRender();
    await this.#updateContentArea();
    this.onLayout.dispatch();
  }

  async #updateContentArea() {
    await this.manager.setContentRect({
      l: this.minPosition * this.scale,
      r: this.maxPosition * this.scale,
      b: this.entryHeight * this.#shownStyles.length
          + TimelineLayout.TRACKS_PADDING * 2
          + TimelineLayout.HEADER_HEIGHT
    });
  }

  async #processDisplaySizeChanged(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.requestedLayout = true;
    await this.#updateContentArea();
    await this.setOffset(this.offset);
    this.manager.requestRender();
  }

  scheduleSampler(delayMs = 80) {
    if (this.#samplerTimer !== null) return;
    this.#samplerTimer = setTimeout(() => {
      this.#samplerTimer = null;
      if (this.requestedSampler)
        this.processSampler();
    }, delayMs);
  }

  processSampler() {
    if (!Playback.sampler) return;
    const s = Playback.sampler;

    const left = this.offset;
    const right = this.offset + this.width / this.scale;
    if (s.isSampling) {
      if (s.sampleProgress + PRELOAD_MARGIN < left) {
        void Debug.trace('cancelling', s.sampleProgress);
        s.tryCancelSampling();
      } else {
        const targetEnd = Math.min(Playback.duration + s.startTime, right + PRELOAD_MARGIN);
        s.changeSamplingEnd(targetEnd);
      }
      return;
    }

    const resolution = s.intensityResolution;
    const i = Math.max(0, Math.floor((left - s.startTime) * resolution)),
          i_end = Math.ceil((right - s.startTime) * resolution);
    const subarray = s.intensityData(1, i, i_end);
    const gapStart = subarray.findIndex((x, i) =>
      i < subarray.length - 1 && isNaN(x) && isNaN(subarray[i+1]));

    if (!Playback.isPlaying || gapStart >= 0)
      this.requestedSampler = false;
    if (gapStart < 0) return;

    const gapEnd = subarray.findIndex((x, i) => i > gapStart && !isNaN(x));

    let start = (gapStart + i) / resolution + s.startTime;
    let end = gapEnd > 0
      ? (gapEnd + i) / resolution + s.startTime
      : right + PRELOAD_MARGIN;

    if (start < s.startTime)
      start = s.startTime;
    if (end > Playback.duration + s.startTime)
      end = Playback.duration + s.startTime;
    if (end == start) return;
    if (end < start) {
      void Debug.debug(start, '>', end);
      return;
    }

    void s.startSampling(start, end);
    this.manager.requestRender();
  }
}

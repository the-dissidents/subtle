<script lang="ts">
  import Color from "colorjs.io";
  import { untrack } from "svelte";
  import Popup, { type PopupHandler } from "./Popup.svelte";
  import NumberInput from "./NumberInput.svelte";

  type Boundary = readonly [number, number, boolean];

  const bounds = {
    srgb: [255, 255, 255] as const,
    hsl: [360, 100, 100] as const,
    oklch: [1, 0.4, 360] as const
  } as const;

  const colorModes = {
    srgb: (v0: number, v1: number, v2: number, alpha = 1) => 
      `rgb(${v0.toFixed(2)} ${v1.toFixed(2)} ${v2.toFixed(2)} / ${alpha})`,
    hsl: (v0: number, v1: number, v2: number, alpha = 1) => 
      `hsl(${v0.toFixed(2)}deg ${v1.toFixed(3)}% ${v2.toFixed(3)}% / ${alpha})`,
    oklch: (v0: number, v1: number, v2: number, alpha = 1) => 
      `oklch(${v0.toFixed(3)} ${v1.toFixed(3)} ${v2.toFixed(2)} / ${alpha})`,
  } as const;

  const fromColorIo = {
    srgb: (v0: number, v1: number, v2: number) => [v0 * 255, v1 * 255, v2 * 255] as const,
    hsl: (v0: number, v1: number, v2: number) => [v0, v1, v2] as const,
    oklch: (v0: number, v1: number, v2: number) => [v0, v1, v2] as const,
  } as const;

  const interpolationMode = {
    srgb: 'in srgb',
    hsl: 'in hsl longer hue',
    oklch: 'in oklch longer hue'
  }
  
  type ColorMode = keyof typeof colorModes;

  function convertMode(to: ColorMode) {
    const newColor = new Color(colorModes[mode](value0, value1, value2));
    newColor.alpha = alpha;
    mode = to;
    updateFromColor(newColor);
    computeBoundaries();
  }

  function parseHex() {
    let match = /#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(hex.toLowerCase());
    if (match) {
      const newColor = new Color(hex);
      newColor.alpha = alpha;
      changed = true;
      updateFromColor(newColor);
      computeBoundaries();
      oninput?.(color);
    } else {
      updateFromValues();
    }
  }

  function computeBoundaries() {
    range0 = getGamutBoundary(bounds[mode][0], (x) => [x,value1,value2]);
    range1 = getGamutBoundary(bounds[mode][1], (x) => [value0,x,value2]);
    range2 = getGamutBoundary(bounds[mode][2], (x) => [value0,value1,x], mode == 'oklch');
  }

  function updateFromValues() {
    color = new Color(colorModes[mode](value0, value1, value2, alpha));
    changed = true;
    updateTexts();
    oninput?.(color);
  }

  function updateFromColor(c: Color) {
    if (color !== c) color = c;
    [value0, value1, value2] = fromColorIo[mode](...color.to(mode).toGamut().coords);
    alpha = c.alpha ?? 1;
    // TODO: this isn't entirely correct, but is effective
    if (Number.isNaN(value0)) value0 = 0;
    if (Number.isNaN(value1)) value1 = 0;
    if (Number.isNaN(value2)) value2 = 0;
    updateTexts();
  }

  function updateTexts() {
    let srgb = color.to('srgb');
    outOfGamut = !srgb.inGamut();
    srgb = srgb.toGamut();
    hex = `#${
      Math.round(srgb.r * 255).toString(16).padStart(2, '0')}${
      Math.round(srgb.g * 255).toString(16).padStart(2, '0')}${
      Math.round(srgb.b * 255).toString(16).padStart(2, '0')}`;
  }

  function getGamutBoundary01(
    fun: (x: number) => [v1: number, v2: number, v3: number], precise = false
  ): null | Boundary {
    const EPISION = 1 / 256;
    const isInside = (x: number) => new Color(colorModes[mode](...fun(x))).inGamut('srgb');

    function findSample(insideness: boolean) {
      let division = 1;
      while (true) {
        const len = 1 / division;
        if (len <= EPISION) return null;
        for (let i = 0; i < division; i++) {
          const m = len * (i + 0.5);
          if (isInside(m) === insideness) return m;
        }
        division *= 2;
      }
    }

    function findTransition(xOut: number, xIn: number): number {
      while (Math.abs(xOut - xIn) > EPISION) {
        const m = (xOut + xIn) / 2;
        if (isInside(m)) xIn = m;
        else xOut = m;
      }
      return xIn;
    }

    const leftIn = isInside(0), rightIn = isInside(1);
    if (leftIn && rightIn) {
      if (precise) {
        const m = findSample(false);
        if (m === null) return [0, 1, false];
        return [findTransition(m, 0), findTransition(m, 1), true];
      } else return [0, 1, false];
    }
    if (leftIn)  return [0, findTransition(1, 0), false];
    if (rightIn) return [findTransition(0, 1), 1, false];
    let m = findSample(true);
    if (m === null) return null;
    return [findTransition(0, m), findTransition(1, m), false];
  }

  function getGamutBoundary(
    bound: number, 
    fun: (x: number) => [v1: number, v2: number, v3: number], 
    precise = false
  ): Boundary | null {
    const x = getGamutBoundary01((x) => fun(x * bound), precise);
    if (x === null) return null;
    return [x[0] * bound, x[1] * bound, x[2]];
  }

  function getRangeGradient(range: Boundary | null, bound: number) {
    const OUT = 'gray';
    const IN = 'transparent'
    if (!range) return OUT;
    let [a, b, c] = range;
    a *= 100 / bound;
    b *= 100 / bound;
    return c 
      ? `linear-gradient(to right, ${IN} ${a}%, ${OUT} ${a}%, ${OUT} ${b}%, ${IN} ${b}%)`
      : `linear-gradient(to right, ${OUT} ${a}%, ${IN} ${a}%, ${IN} ${b}%, ${OUT} ${b}%)`;
  }

  interface Props {
    mode?: ColorMode,
    oninput?: (color: Color) => void,
    onchange?: (color: Color) => void,
    color: Color
  };

  let { mode = $bindable('srgb'), oninput, onchange, color = $bindable() }: Props = $props();

  $effect(() => {
    let _color = color;
    untrack(() => {
      updateFromColor(_color);
      computeBoundaries();
    });
  });

  let value0 = $state(0),
      value1 = $state(0),
      value2 = $state(0),
      alpha = $state(1),
      range0: Boundary | null = $state([0, 1, false]),
      range1: Boundary | null = $state([0, 1, false]),
      range2: Boundary | null = $state([0, 1, false]),
      hex = $state(''),
      outOfGamut = $state(false);

  let changed = false;
  
  let popupHandler: PopupHandler = {};
</script>

<button class="preview-btn" aria-label="color"
  style="--color: {colorModes[mode](value0, value1, value2, 1)};
         --trspColor: {colorModes[mode](value0, value1, value2, alpha)};"
  onclick={(e) => {
    const self = e.currentTarget;
    const rect = self.getBoundingClientRect();
    changed = false;
    popupHandler.openAt?.(rect.left, rect.bottom, Math.max(300, rect.width));
  }}
></button>

<Popup handler={popupHandler} maxWidth="none"
  onclose={() => {
    if (changed) {
      changed = false;
      onchange?.(color);
    }
  }}>
  <div class="hlayout">
    <select value={mode} onchange={(ev) => convertMode(ev.currentTarget.value as ColorMode)}>
      {#each Object.keys(colorModes) as m}
        <option value={m}>{m}</option>
      {/each}
    </select>
    <hr class="flexgrow"/>
  </div>
  <div class='outer hlayout'>
    <div class='vlayout flexgrow'>
      <div class="value-group">
        <div class='slider-container'>
          <span class='back' style="background: {getRangeGradient(range0, bounds[mode][0])}">
            <span class='coloring'
            style="background: linear-gradient(90deg {interpolationMode[mode]}, {
              colorModes[mode](0, value1, value2)}, {
              colorModes[mode](bounds[mode][0], value1, value2)});">
            </span>
          </span>
          <input type="range" bind:value={value0}
            min="0" max={bounds[mode][0]} step="0.001"
            oninput={() => {
              updateFromValues();
              range1 = getGamutBoundary(bounds[mode][1], (x) => [value0, x, value2]);
              range2 = getGamutBoundary(bounds[mode][2], (x) => [value0, value1, x], mode == 'oklch');
            }} />
        </div>
        <NumberInput bind:value={value0} width="10ch"
          min="0" max={bounds[mode][0]} step="0.001" />
      </div>

      <div class="value-group">
        <div class='slider-container'>
          <span class='back' style="background: {getRangeGradient(range1, bounds[mode][1])}">
            <span class='coloring'
              style="background: linear-gradient(90deg {interpolationMode[mode]}, {
              colorModes[mode](value0, 0, value2)}, {
              colorModes[mode](value0, bounds[mode][1], value2)});">
            </span>
          </span>
          <input type="range" bind:value={value1}
            min="0" max={bounds[mode][1]} step="0.001"
            oninput={() => {
              updateFromValues();
              range0 = getGamutBoundary(bounds[mode][0], (x) => [x, value1, value2]);
              range2 = getGamutBoundary(bounds[mode][2], (x) => [value0, value1, x], mode == 'oklch');
            }} />
        </div>
        <NumberInput bind:value={value1} width="10ch"
          min="0" max={bounds[mode][1]} step="0.001" />
      </div>

      <div class="value-group">
        <div class='slider-container'>
          <span class='back' style="background: {getRangeGradient(range2, bounds[mode][2])}">
            <span class='coloring'
              style="background: linear-gradient(90deg {interpolationMode[mode]}, {
              colorModes[mode](value0, value1, 0)}, {
              colorModes[mode](value0, value1, bounds[mode][2])});">
            </span>
          </span>
          <input type="range" bind:value={value2}
            min="0" max={bounds[mode][2]} step="0.001"
            oninput={() => {
              updateFromValues();
              range0 = getGamutBoundary(bounds[mode][0], (x) => [x, value1, value2]);
              range1 = getGamutBoundary(bounds[mode][1], (x) => [value0, x, value2]);
            }} />
        </div>
        <NumberInput bind:value={value2} width="10ch"
          min="0" max={bounds[mode][2]} step="0.001" />
      </div>

      <div class="value-group">
        <div class='slider-container'>
          <span class='back' style="background: transparent;">
            <span class='coloring alpha'
              style="--grad: linear-gradient(90deg, {
              colorModes[mode](value0, value1, value2, 0)}, {
              colorModes[mode](value0, value1, value2, 1)});">
            </span>
          </span>
          <input type="range" bind:value={alpha}
            min="0" max="1" step="0.001"
            oninput={() => {
              updateFromValues();
            }}
            />
        </div>
        <NumberInput bind:value={alpha} width="10ch"
          min="0" max="1" step="0.001" />
      </div>
    </div>
  </div>
  <div class='value-group codes'>
    <input class="flexgrow" type="text" disabled
      value={colorModes[mode](value0, value1, value2, alpha)} />
    {#if outOfGamut}
    <span class="warning" title="The sRGB color space cannot display this color accurately. Your monitor might be using the nearest representable color instead.">⚠️</span>
    {/if}
    <input type="text" bind:value={hex} onchange={() => parseHex()} />
  </div>
</Popup>

<style>
  hr {
    margin-left: 5px;
    border-top: none;
    border-left: none;
    border-right: none;
    border-bottom: 1px dashed gray;
  }

  span.warning {
    cursor: help;
    user-select: none; -webkit-user-select: none;
    -moz-user-select: none; -ms-user-select: none;
  }

  span.back {
    display: inline-block;
    position: absolute;
    top: 5px; left: 0; right: 0; bottom: 5px;
    z-index: -1;
    background-color: whitesmoke;
    border-radius: 3px;
    padding: 0;
    margin: 0;
    box-shadow: 0 1px 3px rgba(128, 128, 128, 0.378);
  }

  .alpha {
    background-image:
      linear-gradient(45deg, #ccc 25%, transparent 25%),
      linear-gradient(-45deg, #ccc 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #ccc 75%),
      linear-gradient(-45deg, transparent 75%, #ccc 75%);
    background-size: 4px 4px;
    background-position: 0 0, 0 2px, 2px -2px, -2px 0px;

    &::before {
      content: '';
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: var(--grad);
    }
  }

  span.coloring {
    display: inline-block;
    position: absolute;
    top: 3px; left: 0; right: 0; bottom: 3px;
    z-index: -1;
    padding: 0;
    margin: 0;
  }

  .slider-container {
    position: relative;
    flex-grow: 1;
  }
  .value-group {
    display: flex;
    gap: 5px;
    & span {
      font-size: 85%;
    }
    & input {
      width: 10ch;
      box-sizing: border-box;
      font-family: var(--monospaceFontFamily);
    }
  }

  .preview-btn {
    width: 100%;
    height: 1.5em;
    position: relative;
    overflow: hidden;

    background-image:
      linear-gradient(45deg, #ccc 25%, transparent 25%),
      linear-gradient(-45deg, #ccc 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #ccc 75%),
      linear-gradient(-45deg, transparent 75%, #ccc 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0px;

    &::before {
      content: '';
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      background: linear-gradient(
        to right, 
        var(--color) 50%, 
        var(--trspColor) 50%
      );
    }
  }

  input[type=range] {
    appearance: none;
    -webkit-appearance: none;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    background: transparent;

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      height: 14px;
      /* margin-top: -10px; */
      width: 2px;
      border-radius: 2px;
      background: white;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(128, 128, 128, 0.378);
    }

    &::-webkit-slider-thumb:hover {
      filter: brightness(97%);
    }

    &::-webkit-slider-runnable-track {
      width: 100%;
      height: 12px;
      cursor: pointer;
      background: transparent;
    }

    &:focus {
      outline: none;
    }
  }
</style>
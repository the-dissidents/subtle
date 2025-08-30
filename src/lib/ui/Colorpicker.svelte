<script lang="ts">
  import Color from "colorjs.io";
  import { untrack } from "svelte";

  const colorModes = {
    srgb: (v0: number, v1: number, v2: number) => 
      `rgb(${(v0 * 255).toFixed(2)} ${(v1 * 255).toFixed(2)} ${(v2 * 255).toFixed(2)})`,
    hsl: (v0: number, v1: number, v2: number) => 
      `hsl(${(v0 * 360).toFixed(2)}deg ${(v1 * 100).toFixed(2)}% ${(v2 * 100).toFixed(2)}%)`,
    oklch: (v0: number, v1: number, v2: number) => 
      `oklch(${(v0).toFixed(2)} ${(v1 * 0.4).toFixed(4)} ${(v2 * 360).toFixed(2)})`,
  } as const;

  const fromColorIo = {
    srgb: (v0: number, v1: number, v2: number) => [v0, v1, v2] as const,
    hsl: (v0: number, v1: number, v2: number) => [v0 / 360, v1 / 100, v2 / 100] as const,
    oklch: (v0: number, v1: number, v2: number) => [v0, v1 / 0.4, v2 / 360] as const,
  } as const;

  const interpolationMode = {
    srgb: 'in srgb',
    hsl: 'in hsl longer hue',
    oklch: 'in oklch longer hue'
  }
  
  type ColorMode = keyof typeof colorModes;

  function convertMode(to: ColorMode) {
    let newColor = new Color(colorModes[mode](value0, value1, value2));
    mode = to;
    setColor(newColor);
    computeBoundaries();
  }

  function parseHex() {
    let match = /#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/.exec(hex.toLowerCase());
    if (match) {
      setColor(new Color(hex));
      computeBoundaries();
      onChange?.(color);
    } else updateColor();
  }

  function computeBoundaries() {
    range0 = getGamutBoundary((x) => [x,value1,value2]);
    range1 = getGamutBoundary((x) => [value0,x,value2]);
    range2 = getGamutBoundary((x) => [value0,value1,x], mode == 'oklch');
  }

  function updateColor() {
    color = new Color(colorModes[mode](value0, value1, value2));
    onChange?.(color);
    setTexts();
  }

  function setColor(c: Color) {
    color = c;
    [value0, value1, value2] = fromColorIo[mode](...color.to(mode).toGamut().coords);
    // TODO: this isn't entirely correct, but is effective
    if (Number.isNaN(value0)) value0 = 0;
    if (Number.isNaN(value1)) value1 = 0;
    if (Number.isNaN(value2)) value2 = 0;
    setTexts();
  }

  function setTexts() {
    let srgb = color.to('srgb');
    outOfGamut = !srgb.inGamut();
    srgb = srgb.toGamut();
    hex = `#${
      Math.round(srgb.r * 255).toString(16).padStart(2, '0')}${
      Math.round(srgb.g * 255).toString(16).padStart(2, '0')}${
      Math.round(srgb.b * 255).toString(16).padStart(2, '0')}`;
  }

  function getGamutBoundary(
    fun: (x: number) => [v1: number, v2: number, v3: number],
    precise = false): null | [number, number, boolean]
  {
    const EPISION = 1 / 256;
    const isInside = (x: number) => new Color(colorModes[mode](...fun(x))).inGamut('srgb');

    function findSample(insideness: boolean) {
      let division = 1;
      while (true) {
        let len = 1 / division;
        if (len <= EPISION) return null;
        for (let i = 0; i < division; i++) {
          let m = len * (i + 0.5);
          if (isInside(m) === insideness) return m;
        }
        division *= 2;
      }
    }

    function findTransition(xOut: number, xIn: number): number {
      while (Math.abs(xOut - xIn) > EPISION) {
        let m = (xOut + xIn) / 2;
        if (isInside(m)) xIn = m;
        else xOut = m;
      }
      return xIn;
    }

    let leftIn = isInside(0), rightIn = isInside(1);
    if (leftIn && rightIn) {
      if (precise) {
        let m = findSample(false);
        if (m === null) return [0, 1, false];
        return [findTransition(m, 0), findTransition(m, 1), true];
      } else return [0, 1, false];
    }
    if (leftIn) return [0, findTransition(1, 0), false];
    if (rightIn) return [findTransition(0, 1), 1, false];
    let m = findSample(true);
    if (m === null) return null;
    return [findTransition(0, m), findTransition(1, m), false];
  }

  function getRangeGradient(range: [number, number, boolean] | null) {
    const OUT = 'gray';
    const IN = 'white'
    if (!range) return OUT;
    let [a, b, c] = range;
    a *= 100;
    b *= 100;
    return c 
      ? `linear-gradient(90deg, ${IN} ${a-0.1}%, ${OUT} ${a}%, ${OUT} ${b}%, ${IN} ${b+0.1}%)`
      : `linear-gradient(90deg, ${OUT} ${a-0.1}%, ${IN} ${a}%, ${IN} ${b}%, ${OUT} ${b+0.1}%)`;
  }

  interface Props {
    mode?: ColorMode,
    onChange?: (color: Color) => void,
    color: Color
  };

  let { mode = $bindable('srgb'), onChange, color = $bindable() }: Props = $props();

  $effect(() => {
    let _color = color;
    untrack(() => {
      setColor(_color);
      computeBoundaries();
    });
  });

  let value0 = $state(0),
      value1 = $state(0),
      value2 = $state(0),
      range0: ([number, number, boolean] | null) = $state([0, 1, false]),
      range1: ([number, number, boolean] | null) = $state([0, 1, false]),
      range2: ([number, number, boolean] | null) = $state([0, 1, false]),
      hex = $state(''),
      outOfGamut = $state(false);
</script>

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
    <div class='slider-container'>
      <span class='back' style="background: {getRangeGradient(range0)}">
        <span class='coloring'
        style="background: linear-gradient(90deg {interpolationMode[mode]}, {
          colorModes[mode](0, value1, value2)}, {
          colorModes[mode](1, value1, value2)});">
        </span>
      </span>
      <input type="range" min="0" max="1" step="any"
        bind:value={value0}
        oninput={() => {
          updateColor();
          range1 = getGamutBoundary((x) => [value0, x, value2]);
          range2 = getGamutBoundary((x) => [value0, value1, x], mode == 'oklch');
        }}/>
    </div>
    <div class='slider-container'>
      <span class='back' style="background: {getRangeGradient(range1)}">
        <span class='coloring'
          style="background: linear-gradient(90deg {interpolationMode[mode]}, {
          colorModes[mode](value0, 0, value2)}, {
          colorModes[mode](value0, 1, value2)});">
        </span>
      </span>
      <input type="range" min="0" max="1" step="any"
        bind:value={value1}
        oninput={() => {
          updateColor();
          range0 = getGamutBoundary((x) => [x, value1, value2]);
          range2 = getGamutBoundary((x) => [value0, value1, x], mode == 'oklch');
        }}/>
    </div>
    <div class='slider-container'>
      <span class='back' style="background: {getRangeGradient(range2)}">
        <span class='coloring'
          style="background: linear-gradient(90deg {interpolationMode[mode]}, {
          colorModes[mode](value0, value1, 0)}, {
          colorModes[mode](value0, value1, 1)});">
        </span>
      </span>
      <input type="range" min="0" max="1" step="any"
        bind:value={value2}
        oninput={() => {
          updateColor();
          range0 = getGamutBoundary((x) => [x, value1, value2]);
          range1 = getGamutBoundary((x) => [value0, x, value2]);
        }}/>
    </div>
  </div>
  <div class='preview-container vlayout'>
    <div class='preview'
      style="background-color: {colorModes[mode](value0, value1, value2)};"></div>
  </div>
</div>
<div class='values hlayout'>
  <input class="flexgrow" type="text" value={colorModes[mode](value0, value1, value2)} disabled/>
  {#if outOfGamut}<span class="warning" title="The sRGB color space cannot display this color accurately. Your monitor might be using the nearest representable color instead.">⚠️</span>{/if}
  <input type="text" bind:value={hex} onchange={() => parseHex()} />
</div>
<!-- <p>{range0};{range1};{range2}</p> -->

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

  span.coloring {
    display: inline-block;
    position: absolute;
    top: 4px; left: 0; right: 0; bottom: 4px;
    z-index: -1;
    padding: 0;
    margin: 0;
  }

  .slider-container {
    position: relative;
  }

  .preview-container {
    justify-content: center;
    padding-left: 5px;
  }

  .preview {
    border: gray 1px solid;
    box-sizing: border-box;
    height: 60px;
    width: 60px;
  }

  .values {
    font-size: 85%;
  }
  .values span {
    font-size: 85%;
    line-height: normal;
    margin-right: 4px;
  }
  .values input {
    width: 60px;
    box-sizing: border-box;
  }

  input[type=range] {
    appearance: none;
    -webkit-appearance: none; /* Hides the slider so that custom slider can be made */
    width: 100%; /* Specific width is required for Firefox. */
    height: 100%;
    margin: 0;
    padding: 0;
    background: transparent; /* Otherwise white in Chrome */

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
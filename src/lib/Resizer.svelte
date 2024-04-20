<script lang="ts">
	export let control: HTMLElement;
  export let control2: HTMLElement | null = null;
	export let vertical = false;
  export let reverse = false;
  export let minValue = 10;
  let cx = 0, cy = 0, orig = 0, orig2 = 0;
  let dragging = false;
</script>

<svelte:document 
  on:mousemove={(ev) => {
    if (dragging) {
      let f = reverse ? -1 : 1;
      if (vertical) {
        let val = Math.max(orig + (ev.clientX - cx) * f, minValue);
        if (control2) control2.style.width = (orig2 + val - orig) + 'px';
        control.style.width = val + 'px';
      } else {
        let val = Math.max(orig + (ev.clientY - cy) * f, minValue);
        if (control2) control2.style.height = (orig2 + val - orig) + 'px';
        control.style.height = val + 'px';
      }
    }
  }}
  on:mouseup={() => {
    dragging = false;
  }}/>
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class={vertical ? 'resizerV' : 'resizerH'} 
  style='cursor: {vertical ? 'ew-resize' : 'ns-resize'}'
  on:mousedown={(ev) => {
	  cx = ev.clientX;
    cy = ev.clientY;
    orig = vertical ? control.offsetWidth : control.offsetHeight;
    if (control2) {
      orig2 = vertical ? control2.offsetWidth : control2.offsetHeight;
    }
    dragging = true;
  }}>
<slot />
</div>

<style>
.resizerH {
  height: 2px;
  width: 100%;
  margin: 2px;
  background-color: gray;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
}
.resizerV {
  height: 100%;
  width: 2px;
  margin: 2px;
  background-color: gray;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
}
</style>
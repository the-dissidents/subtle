<script lang="ts">
  interface Props {
    control: HTMLElement;
    control2?: HTMLElement | null;
    vertical?: boolean;
    reverse?: boolean;
    minValue?: number;
    children?: import('svelte').Snippet;
  }

  let {
    control = $bindable(),
    control2 = $bindable(null),
    vertical = false,
    reverse = false,
    minValue = 10,
    children
  }: Props = $props();
  let cx = $state(0), cy = $state(0), orig = $state(0), orig2 = $state(0);
  let dragging = $state(false);
</script>

<svelte:document 
  onmousemove={(ev) => {
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
  onmouseup={() => {
    dragging = false;
  }}/>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class={vertical ? 'resizerV' : 'resizerH'} 
  style='cursor: {vertical ? 'ew-resize' : 'ns-resize'}'
  onmousedown={(ev) => {
	  cx = ev.clientX;
    cy = ev.clientY;
    orig = vertical ? control.offsetWidth : control.offsetHeight;
    if (control2) {
      orig2 = vertical ? control2.offsetWidth : control2.offsetHeight;
    }
    dragging = true;
  }}>
<div class='inside'></div>
{@render children?.()}
</div>

<style>
.resizerH {
  height: 5px;
  width: 100%;
  margin: 2px;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
}

.resizerH .inside {
  width: 100%;
  height: 1px;
  background-color: gray;
  transform: translateY(50%);
  /* transition: all 0.2s ease-out; */
}

.resizerH:hover .inside {
  height: 3px;
  background-color: palevioletred;
  transform: translateY(-25%);
}

.resizerV {
  height: 100%;
  width: 5px;
  margin: 2px;
  user-select: none; -webkit-user-select: none;
  -moz-user-select: none; -ms-user-select: none;
}

.resizerV .inside {
  height: 100%;
  width: 1px;
  background-color: gray;
  transform: translateX(50%);
  /* transition: all 0.2s ease-out; */
}

.resizerV:hover .inside {
  width: 3px;
  background-color: palevioletred;
  transform: translateX(-25%);
}
</style>
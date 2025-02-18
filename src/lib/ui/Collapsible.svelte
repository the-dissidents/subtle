<script lang="ts">
    import Tooltip from "./Tooltip.svelte";

  export let header = "";
  export let helpText = "";
  export let active = false;
  export let showCheck = false;
  export let checked = false;
</script>

<button type="button" class="collapsible hlayout"
  class:active class:checked
  on:click={() => {active = !active}}
>
  <span class='caret flexgrow'>{header}</span>

  {#if helpText != ""}
  <Tooltip position='left' text={helpText}>
    <span class='info'>i</span>
  </Tooltip>
  {/if}
  
  <span class='check' class:hidden={!showCheck}>
    <input type='checkbox' bind:checked 
      on:click={(e) => e.stopPropagation()}/>
  </span>
</button>
<div class='content' class:active={active}>
  <slot />
</div>

<style>
.info {
  font-family: 'Webdings';
  font-size: 120%;
  color: gray;
  margin-right: 5px;
}
.check {
  display: inline-block;
  text-align: right;
}
.hidden {
  display: none;
}
button.collapsible {
  background-color: whitesmoke;
  padding: 5px;
  width: 100%;
  border: none;
  border-radius: 3px;
  text-align: left;
  outline: none;
  box-shadow: none;
}
button.checked {
  background-color: var(--uchu-green-1) !important;
}
button.collapsible.active .caret::before {
  transform: rotate(90deg);
}
.caret::before {
  content: "\25B6";
  color: var(--uchu-yin);
  display: inline-block;
  margin-right: 6px;
}
.content {
  max-height: 0;
  overflow: hidden;
  /* transition: max-height 1s ease-out; */
}
.content.active {
  max-height: max-content;
}
</style>
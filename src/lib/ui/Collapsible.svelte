<script lang="ts">
import Tooltip from "./Tooltip.svelte";

interface Props {
  header?: string;
  helpText?: string;
  active?: boolean;
  showCheck?: boolean;
  checked?: boolean;
  children?: import('svelte').Snippet;
}

let {
  header = "",
  helpText = "",
  active = $bindable(false),
  showCheck = false,
  checked = $bindable(false),
  children
}: Props = $props();
</script>

<button type="button" class="collapsible hlayout"
  class:active class:checked
  onclick={() => {active = !active}}
>
  <span class='caret flexgrow'>{header}</span>

  {#if helpText != ""}
  <Tooltip position='left' text={helpText}>
    <span class='info'>i</span>
  </Tooltip>
  {/if}
  
  <span class='check' class:hidden={!showCheck}>
    <input type='checkbox' bind:checked 
      onclick={(e) => e.stopPropagation()}/>
  </span>
</button>
<div class='content' class:active={active}>
  {@render children?.()}
</div>

<style>
@media (prefers-color-scheme: light) {
  button.collapsible {
    background-color: var(--uchu-yin-1);
  }
  button.checked {
    background-color: var(--uchu-red-1) !important;
  }
}

@media (prefers-color-scheme: dark) {
  button.collapsible {
    outline: 1px solid var(--uchu-yin-8);
    background-color: var(--uchu-yin-9);
  }
  button.checked {
    background-color: var(--uchu-green-9) !important;
  }
}

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
  padding: 3px 5px;
  margin-top: 5px;
  /* width: 100%; */
  border: none;
  border-radius: 3px;
  text-align: left;
  box-shadow: none;
}
button.collapsible.active .caret::before {
  transform: rotate(90deg);
}
.caret::before {
  content: "\25B6";
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
<script lang="ts">
  export let header = "";
  export let active = false;
</script>

<button type="button" class="collapsible"
  class:active
  on:click={() => {active = !active}}
>
  <span class='caret'>{header}</span>
</button>
<div class='content' class:active={active}>
  <slot />
</div>

<style>
.collapsible {
  background-color: #eeeeee;
  padding: 5px;
  width: 100%;
  border: none;
  border-radius: 3px;
  text-align: left;
  outline: none;
  box-shadow: none;
}
.collapsible.active .caret::before {
  transform: rotate(90deg);
}
.caret::before {
  content: "\25B6";
  color: black;
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
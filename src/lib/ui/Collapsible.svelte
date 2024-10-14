<script lang="ts">
  export let header = "";
  export let active = false;
  export let showCheck = false;
  export let checked = false;
</script>

<button type="button" class="collapsible hlayout"
  class:active class:checked
  on:click={() => {active = !active}}
>
  <span class='caret'>{header}</span>
  <span class='check flexgrow' class:hidden={!showCheck}>
    <input type='checkbox' bind:checked 
      on:click={(e) => e.stopPropagation()}/>
  </span>
</button>
<div class='content' class:active={active}>
  <slot />
</div>

<style>
.check {
  display: inline-block;
  text-align: right;
}
.hidden {
  display: none;
}
button.collapsible {
  background-color: #eeeeee;
  padding: 5px;
  width: 100%;
  border: none;
  border-radius: 3px;
  text-align: left;
  outline: none;
  box-shadow: none;
}
button.checked {
  background-color: lightblue !important;
}
button.collapsible.active .caret::before {
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
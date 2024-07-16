<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { assert } from "./Basic";
  import { SubtitleStyle, SubtitleTools, type Subtitles } from "./Subtitles";
  import { showMenu } from "tauri-plugin-context-menu";
  import { ChangeCause, ChangeType, type Frontend } from "./Frontend";

	const dispatch = createEventDispatcher();
	const submit = () => dispatch('submit');

  export let style: SubtitleStyle;
  export let subtitles: Subtitles;
  export let frontend: Frontend;
  let alignSelector: HTMLSelectElement;
  let button: HTMLButtonElement;

  $: if (alignSelector) alignSelector.selectedIndex = style.alignment - 1;

  function isDuplicate(name: string) {
    for (let s of [...subtitles.styles, subtitles.defaultStyle]) {
      if (s === style) continue;
      if (s.name == name) return true;
    }
    return false;
  }

  function contextMenu() {
    let isDefault = style == subtitles.defaultStyle;
    let used = subtitles.entries.filter(
      (x) => x.texts.find((c) => c.style == style) !== undefined);
    let withoutThis = isDefault ? [] : [subtitles.defaultStyle];
    withoutThis.push(...subtitles.styles.filter((x) => x !== style));
    // let position = button.getBoundingClientRect();
    showMenu({
      // pos: {
      //   x: position.left + window.scrollX,
      //   y: position.bottom + window.scrollY
      // },
      items: [
      {
        label: 'delete',
        disabled: used.length > 0 || isDefault,
        event: () => {
          let i = subtitles.styles.indexOf(style);
          if (i < 0) return;
          subtitles.styles.splice(i, 1);
          frontend.markChanged(ChangeType.Styles, ChangeCause.Action);
          submit();
        }
      },
      {
        label: 'replace by',
        disabled: withoutThis.length == 0,
        subitems: withoutThis.map((x) => ({
          label: x.name,
          payload: x,
          event: (e) => {
            if (e && SubtitleTools.replaceStyle(
              subtitles.entries, style, e.payload as SubtitleStyle))
                frontend.markChanged(ChangeType.NonTime, ChangeCause.Action);
          }
        }))
      },
      {
        label: 'duplicate',
        event: () => {
          let clone = style.clone();
          clone.name = SubtitleTools.getUniqueStyleName(subtitles, style.name);
          subtitles.styles.push(clone);
          subtitles.styles = subtitles.styles;
          frontend.markChanged(ChangeType.Styles, ChangeCause.Action);
          submit();
        }
      }
    ]});
  }
</script>

<tr>
  <td class='toolbar' rowspan="10">
    <button disabled={style == subtitles.defaultStyle}
      on:click={() => {
        let i = subtitles.styles.indexOf(style);
        assert(i >= 0);
        let newStyle = new SubtitleStyle('new');
        subtitles.styles = subtitles.styles.toSpliced(i, 0, newStyle);
        submit();
      }}>+</button>
    <br/>
    <button disabled={style == subtitles.defaultStyle || style == subtitles.styles[0]}
      on:click={() => {
        let i = subtitles.styles.indexOf(style);
        assert(i >= 0);
        subtitles.styles = [
          ...subtitles.styles.slice(0, i-1), 
          style, 
          subtitles.styles[i-1],
          ...subtitles.styles.slice(i+1)];
        submit();
      }}>↑</button>
    <button disabled={style == subtitles.defaultStyle || style == subtitles.styles.at(-1)}
      on:click={() => {
        let i = subtitles.styles.indexOf(style);
        assert(i >= 0);
        subtitles.styles = [
          ...subtitles.styles.slice(0, i), 
          subtitles.styles[i+1],
          style, 
          ...subtitles.styles.slice(i+2)];
        submit();
      }}>↓</button>
    <button bind:this={button} on:click={() => contextMenu()}>...</button>
  </td>
  <td><label for='name'>name:</label></td>
  <td><input id='name' bind:value={style.name}
    class={isDuplicate(style.name) ? 'duplicate' : ''}
    on:change={() => frontend.markChanged(ChangeType.Styles, ChangeCause.Action)}/></td>
</tr>
<tr>
  <td><label for='font'>font:</label></td>
  <td><input id='font' bind:value={style.font}/></td>
</tr>
<tr>
  <td><label for='size'>font size:</label></td>
  <td><input id='size' type='number' bind:value={style.size}/></td>
</tr>
<tr>
  <td></td>
  <td>
    <input type='checkbox' id='bold' bind:checked={style.styles.bold}/><label for="bold">bold</label>
    <input type='checkbox' id='italic' bind:checked={style.styles.italic}/><label for="italic">italic</label>
    <input type='checkbox' id='underline' bind:checked={style.styles.underline}/><label for="underline">underline</label>
    <input type='checkbox' id='strikethru' bind:checked={style.styles.strikethrough}/><label for="strikethru">strikethru</label>
  </td>
</tr>

<tr>
  <td><label for='color'>text color:</label></td>
  <td><input id='color' bind:value={style.color}/></td>
</tr>
<tr>
  <td><label for='ocolor'>line color:</label></td>
  <td><input id='ocolor' bind:value={style.outlineColor}/></td>
</tr>
<tr>
  <td><label for='outline'>line size:</label></td>
  <td><input id='outline' type='number' bind:value={style.outline}/></td>
</tr>
<tr>
  <td><label for='shadow'>shadow:</label></td>
  <td><input id='shadow' type='number' bind:value={style.shadow}/></td>
</tr>
<tr>
  <td><label for='align'>alignment:</label></td>
  <td><select id='align'
      bind:this={alignSelector}
      on:input={() => style.alignment = alignSelector.selectedIndex + 1}>
    <option value="BottomLeft">bottom left</option>
    <option value="BottomCenter">bottom center</option>
    <option value="BottomRight">bottom right</option>
    <option value="CenterLeft">center left</option>
    <option value="Center">center</option>
    <option value="CenterRight">center right</option>
    <option value="TopLeft">top left</option>
    <option value="TopCenter">top center</option>
    <option value="TopRight">top right</option>
  </select></td>
</tr>
<tr>
  <td>margins:</td>
  <td><table class='margin'>
    <tr><td>top</td><td>bottom</td><td>left</td><td>right</td></tr>
    <tr>
      <td><input type='number' bind:value={style.margin.top}/></td>
      <td><input type='number' bind:value={style.margin.bottom}/></td>
      <td><input type='number' bind:value={style.margin.left}/></td>
      <td><input type='number' bind:value={style.margin.right}/></td>
    </tr>
  </table></td>
</tr>

<style>
.duplicate {
  background-color: lightcoral;
}

.toolbar {
  vertical-align: top;
  padding-right: 10px;
}

button {
  width: 25px;
  height: 20px;
}

input {
  width: 100%;
}

input[type='checkbox'] {
  width: auto;
  margin-right: 5px;
}

.margin input {
  width: 60px;
}
</style>
<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { assert } from "./Basic";
  import { SubtitleStyle, SubtitleTools, type Subtitles } from "./Subtitles";
  import { ChangeCause, ChangeType, type Frontend } from "./Frontend";
  import { Menu } from "@tauri-apps/api/menu";
  import Collapsible from "./ui/Collapsible.svelte";

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

  async function contextMenu() {
    let isDefault = style == subtitles.defaultStyle;
    let used = subtitles.entries.filter(
      (x) => x.texts.find((c) => c.style == style) !== undefined);
    let withoutThis = isDefault ? [] : [subtitles.defaultStyle];
    withoutThis.push(...subtitles.styles.filter((x) => x !== style));
    
    let menu = await Menu.new({
      items: [
      {
        text: 'delete',
        enabled: used.length == 0 && !isDefault,
        action() {
          let i = subtitles.styles.indexOf(style);
          if (i < 0) return;
          subtitles.styles.splice(i, 1);
          frontend.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
          submit();
        }
      },
      {
        text: 'replace by',
        enabled: withoutThis.length > 0,
        items: withoutThis.map((x, i) => ({
          id: i.toString(),
          text: x.name,
          action(id) {
            let n = Number.parseInt(id);
            let other = withoutThis[n];
            if (SubtitleTools.replaceStyle(subtitles.entries, style, other))
                frontend.markChanged(ChangeType.TextOnly, ChangeCause.Action);
          }
        }))
      },
      {
        text: 'duplicate',
        action() {
          let clone = style.clone();
          clone.name = SubtitleTools.getUniqueStyleName(subtitles, style.name);
          subtitles.styles.push(clone);
          subtitles.styles = subtitles.styles;
          frontend.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
          submit();
        }
      }
    ]});
    menu.popup();
  }
</script>

<div class='split'>
  <!-- toolbar -->
  <div class="toolbar">
    <button disabled={style == subtitles.defaultStyle}
      on:click={() => {
        let i = subtitles.styles.indexOf(style);
        assert(i >= 0);
        let newStyle = new SubtitleStyle('new');
        subtitles.styles = subtitles.styles.toSpliced(i, 0, newStyle);
        submit();
      }}>+</button><br/>
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
      }}>↑</button><br/>
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
      }}>↓</button><br/>
    <button bind:this={button} on:click={() => contextMenu()}>...</button>
  </div>
  <!-- properties -->
  <div>
    <!-- basic -->
    <table class="stretch">
      <tr>
        <td><label for='name'>name:</label></td>
        <td><input id='name' bind:value={style.name}
          class={isDuplicate(style.name) ? 'duplicate' : ''}
          on:change={() => frontend.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action)}/></td>
      </tr>
      <tr>
        <td><label for='font'>font:</label></td>
        <td><input id='font' bind:value={style.font}/></td>
      </tr>
      <tr>
        <td><label for='size'>size:</label></td>
        <td><input id='size' type='number' bind:value={style.size}/></td>
      </tr>
      <tr>
        <td></td>
        <td>
          <div class="flex style">
            <div>
              <input type='checkbox' id='bold' bind:checked={style.styles.bold}/><label for="bold">B</label>
            </div>
            <div>
              <input type='checkbox' id='italic' bind:checked={style.styles.italic}/><label for="italic">I</label>
            </div>
            <div>
              <input type='checkbox' id='underline' bind:checked={style.styles.underline}/><label for="underline">U</label>
            </div>
            <div>
              <input type='checkbox' id='strikethru' bind:checked={style.styles.strikethrough}/><label for="strikethru">S</label>
            </div>
          </div>
        </td>
      </tr>
    </table>
    <!-- advanced -->
    <Collapsible header='more'>
      <table class="stretch">
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
          <td>
            <div class="flex margin">
              <div>
                <label for='top'>top:</label>
                <input id='top' type='number' bind:value={style.margin.top}/>
              </div>
              <div>
                <label for='bottom'>bottom:</label>
                <input id='bottom' type='number' bind:value={style.margin.bottom}/>
              </div>
              <div>
                <label for='left'>left:</label>
                <input id='left' type='number' bind:value={style.margin.left}/>
              </div>
              <div>
                <label for='right'>right:</label>
                <input id='right' type='number' bind:value={style.margin.right}/>
              </div>
            </div>
          </td>
        </tr>
      </table>
    </Collapsible>
  </div>
</div>
<hr>

<style>
.duplicate {
  background-color: lightcoral;
}

.toolbar {
  text-align: right;
  vertical-align: top;
  padding-right: 10px;
}

.flex {
  display: flex;
  flex-wrap: wrap;
}

.split {
  display: flex;
}

.split div {
  height: 100%;
}

.stretch {
  width: 100%;
}

.style div {
  padding-right: 5px;
  font-family: 'Times New Roman', Times, serif;
}
.style label[for='bold'] {
  font-weight: bold;
}
.style label[for='italic'] {
  font-style: italic;
}
.style label[for='underline'] {
  text-decoration: underline;
}
.style label[for='strikethru'] {
  text-decoration: line-through;
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
.margin label {
  width: 50px;
  display: inline-block;
}
.margin div {
  padding-right: 5px;
}

hr {
  border: 0.5px solid rgb(193, 193, 193);
  border-radius: 0.5px;
}
</style>
<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { assert } from "./Basic";
  import { AlignMode, SubtitleStyle, SubtitleTools, type Subtitles } from "./core/Subtitles.svelte";
  import { Menu } from "@tauri-apps/api/menu";
  import Collapsible from "./ui/Collapsible.svelte";
  import { writable } from 'svelte/store';
    import { ChangeCause, ChangeType, Source } from "./frontend/Source";

	const dispatch = createEventDispatcher();
	const submit = () => dispatch('submit');

  interface Props {
    style: SubtitleStyle;
    subtitles: Subtitles;
  }

  let { style: _style, subtitles = $bindable() }: Props = $props();
  let alignSelector: HTMLSelectElement | undefined = $state();
  let button: HTMLButtonElement | undefined = $state();
  let style = writable(_style);

  function isDuplicate(name: string) {
    for (let s of [...subtitles.styles, subtitles.defaultStyle]) {
      if (s === _style) continue;
      if (s.name == name) return true;
    }
    return false;
  }

  async function contextMenu() {
    let isDefault = $style == subtitles.defaultStyle;
    let used = subtitles.entries.filter(
      (x) => x.texts.find((c) => c.style == $style) !== undefined);
    let withoutThis = isDefault ? [] : [subtitles.defaultStyle];
    withoutThis.push(...subtitles.styles.filter((x) => x !== $style));
    
    let menu = await Menu.new({
      items: [
      {
        text: 'delete',
        enabled: used.length == 0 && !isDefault,
        action() {
          let i = subtitles.styles.indexOf($style);
          if (i < 0) return;
          subtitles.styles.splice(i, 1);
          Source.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
          submit();
        }
      },
      {
        text: 'duplicate',
        action() {
          let clone = $style.clone();
          clone.name = SubtitleTools.getUniqueStyleName(subtitles, $style.name);
          subtitles.styles.push(clone);
          subtitles.styles = subtitles.styles;
          Source.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
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
            if (SubtitleTools.replaceStyle(subtitles.entries, $style, other))
              Source.markChanged(ChangeType.InPlace, ChangeCause.Action);
          }
        }))
      },
      {
        text: 'set as default',
        enabled: subtitles.defaultStyle != $style,
        action() {
          let oldDefault = subtitles.defaultStyle;
          subtitles.defaultStyle = $style;
          const index = subtitles.styles.indexOf($style);
          subtitles.styles.splice(index, 1);
          subtitles.styles.splice(0, 0, oldDefault);
          Source.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
          submit();
        }
      },
    ]});
    menu.popup();
  }
</script>

<div class='hlayout'>
  <!-- toolbar -->
  <div class="toolbar">
    {#if $style !== subtitles.defaultStyle}
    <!-- add style -->
    <button
      onclick={() => {
        let i = subtitles.styles.indexOf($style);
        assert(i >= 0);
        let newStyle = new SubtitleStyle('new');
        subtitles.styles = subtitles.styles.toSpliced(i, 0, newStyle);
        Source.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
        submit();
      }}>+</button><br/>
    <!-- move up -->
    <button disabled={$style === subtitles.styles[0]}
      onclick={() => {
        let i = subtitles.styles.indexOf($style);
        assert(i >= 0);
        subtitles.styles = [
          ...subtitles.styles.slice(0, i-1), 
          $style, 
          subtitles.styles[i-1],
          ...subtitles.styles.slice(i+1)
        ];
        Source.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
        submit();
      }}>↑</button><br/>

    <!-- move down -->
    <button disabled={$style === subtitles.styles.at(-1)}
      onclick={() => {
        let i = subtitles.styles.indexOf($style);
        assert(i >= 0);
        subtitles.styles = [
          ...subtitles.styles.slice(0, i), 
          subtitles.styles[i+1],
          $style, 
          ...subtitles.styles.slice(i+2)
        ];
        Source.markChanged(ChangeType.StyleDefinitions, ChangeCause.Action);
        submit();
      }}>↓</button><br/>
    {/if}
    <button bind:this={button} onclick={() => contextMenu()}>...</button>
  </div>
  <!-- properties -->
  <div class="flexgrow">
    <!-- basic -->
    <table class="stretch">
      <tbody>
        <tr>
          <td>name:</td>
          <td><input bind:value={$style.name}
            class={isDuplicate($style.name) ? 'duplicate' : ''}
            onchange={() => 
              Source.markChanged(ChangeType.InPlace, ChangeCause.Action)}/></td>
        </tr>
        <tr>
          <td>font:</td>
          <td><input bind:value={$style.font}/></td>
        </tr>
        <tr>
          <td>size:</td>
          <td><input type='number' bind:value={$style.size}/></td>
        </tr>
        <tr>
          <td></td>
          <td>
            <div class="flex style">
              <div>
                <label><input type='checkbox' bind:checked={$style.styles.bold}/><b>B</b></label>
              </div>
              <div>
                <label><input type='checkbox' bind:checked={$style.styles.italic}/><i>I</i></label>
              </div>
              <div>
                <label><input type='checkbox' bind:checked={$style.styles.underline}/><u>U</u></label>
              </div>
              <div>
                <label><input type='checkbox' bind:checked={$style.styles.strikethrough}/><s>S</s></label>
              </div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <!-- advanced -->
    <Collapsible header='more'>
      <table class="stretch">
        <tbody>
          <tr>
            <td>text color:</td>
            <td><input bind:value={$style.color}/></td>
          </tr>
          <tr>
            <td>line color:</td>
            <td><input bind:value={$style.outlineColor}/></td>
          </tr>
          <tr>
            <td>line size:</td>
            <td><input type='number' bind:value={$style.outline}/></td>
          </tr>
          <tr>
            <td>shadow:</td>
            <td><input type='number' bind:value={$style.shadow}/></td>
          </tr>
          <tr>
            <td>alignment:</td>
            <td><select
                bind:this={alignSelector}
                value={AlignMode[$style.alignment]}
                oninput={() => $style.alignment = alignSelector!.selectedIndex + 1}>
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
                <div><label>top:
                    <input type='number' bind:value={$style.margin.top}/>
                </label></div>
                <div><label>bottom:
                  <input type='number' bind:value={$style.margin.bottom}/>
                </label></div>
                <div><label>left:
                  <input type='number' bind:value={$style.margin.left}/>
                </label></div>
                <div><label>right:
                  <input type='number' bind:value={$style.margin.right}/>
                </label></div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </Collapsible>
  </div>
</div>

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

.stretch {
  width: 100%;
}

table td:first-child {
  font-size: 95%;
  /* text-transform: uppercase; */
  /* font-weight: bold; */
}

.style div {
  padding-right: 5px;
  font-family: 'Times New Roman', Times, serif;
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
  padding-right: 15px;
}
</style>
<script lang="ts" module>
	export class DialogHandler<TInput = void, TOutput = string> {
		showModal?: (i: TInput) => Promise<TOutput>;
	}
</script>

<script lang="ts">
    import { assert } from "./Basic";
    import type { Frontend } from "./Frontend";

	export type DialogButton = {
		name: string,
		enabled: boolean
	} | string;

	interface Props {
		handler: DialogHandler<void, string>;
		centerWhenOpen?: boolean;
		maxWidth?: string;
		frontend: Frontend;
		header?: import('svelte').Snippet;
		children?: import('svelte').Snippet;
		buttons?: DialogButton[];
	}

	let {
		handler = $bindable(),
		centerWhenOpen = true,
		maxWidth = '32em',
		frontend = $bindable(),
		header,
		children,
		buttons = ['cancel', 'ok'],
	}: Props = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let cx: number, cy: number, ox: number, oy: number;
	let posx: number = $state(0), posy: number = $state(0);

	function makeCenter() {
		posx = (window.innerWidth - dialog!.clientWidth) / 2;
		posy = (window.innerHeight - dialog!.clientHeight) / 2;
	}

	function startDrag(ev: MouseEvent) {
		cx = ev.clientX;
		cy = ev.clientY;
		ox = posx; oy = posy;
		let handler1 = (ev: MouseEvent) => {
			posx = ox + ev.clientX - cx;
			posy = oy + ev.clientY - cy;
		};
		let handler2 = () => {
			document.removeEventListener('mousemove', handler1);
			document.removeEventListener('mouseup', handler2);
		};
		document.addEventListener('mousemove', handler1);
		document.addEventListener('mouseup', handler2);
	}

	let resolve: ((btn: string) => void) | undefined;
	assert(handler !== null);
	handler.showModal = async () => {
		return new Promise((r) => {
			resolve = (btn) => {
				r(btn);
				dialog?.close();
				resolve = undefined;
			};
			assert(dialog !== undefined);
			assert(!dialog.open);
			dialog.showModal();
			if (centerWhenOpen) makeCenter();
			frontend.states.modalOpenCounter++;
		});
	}
</script>
	
<dialog
	bind:this={dialog}
	class='modal'
	style="top: {posy}px; left: {posx}px; max-width: {maxWidth};"
	onclose={() => frontend.states.modalOpenCounter--}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<header onmousedown={(ev) => startDrag(ev)}>
		{@render header?.()}
	</header>
	<div>
		{@render children?.()}
	</div>
	<footer>
		{#each buttons as btn}
		{#if typeof btn == 'string'}
			<button 
				class='submit' 
				onclick={() => {
					assert(resolve !== undefined);
					resolve(btn);
				}}
			>{btn}</button>
		{:else}
			<button 
				class='submit'
				disabled={!btn.enabled}
				onclick={() => {
					assert(resolve !== undefined);
					resolve(btn.name);
				}}
			>{btn.name}</button>
		{/if}
		{/each}
	</footer>
</dialog>

<style>
	dialog {
		border-radius: 0.3em;
		border: none;
		margin: 0;
		padding: 0;
		box-shadow: 0 0 10px gray;
		position: absolute;
		/* transform: translate(-50%, -50%); */
		z-index: 100;
		max-height: 80vh;
	}
	dialog.modal::backdrop {
		background: rgba(0, 0, 0, 0.3);
	}
	dialog[open] {
		animation: zoom 0.2s ease-out;
	}
	@keyframes zoom {
		from { transform: scale(0.95); }
		to { transform: scale(1); }
	}
	dialog.modal[open]::backdrop {
		animation: fade 0.2s ease-out;
	}
	@keyframes fade {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	/* hr {
		border: 1px solid gray;
		margin: 10px 0 10px 0;
	} */
	header {
		/* cursor: move; */
		padding: 1em 1.5em 1px;
		/* box-shadow: 0 -10px 10px 10px gray; */
	}
	dialog > div {
		padding: 0 1.5em 1em;
	}
	footer {
		padding: 1em 1.5em 1em;
		text-align: right;
		background-color: rgb(226, 226, 226);
	}
	.submit {
		/* position: absolute; */
		padding: 4px 6px;
		margin-left: 5px;
	}
</style>

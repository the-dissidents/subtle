<script lang="ts" module>
	export class DialogHandler<T> {
		show = writable<boolean>(false);
		onSubmit: ((arg: T) => void) | undefined = undefined;
	}
</script>

<script lang="ts">
    import { assert } from "./Basic";

    import type { Frontend } from "./Frontend";
    import { writable, type Writable } from "svelte/store";

	interface Props {
		handler: DialogHandler<void>;
		modal?: boolean;
		centerWhenOpen?: boolean;
		frontend: Frontend;
		header?: import('svelte').Snippet;
		children?: import('svelte').Snippet;
	}

	let {
		handler = $bindable(),
		modal = true,
		centerWhenOpen = true,
		frontend = $bindable(),
		header,
		children
	}: Props = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	let cx: number, cy: number, ox: number, oy: number;
	let posx: number = $state(0), posy: number = $state(0);
	makeCenter();

	function makeCenter() {
		posx = window.innerWidth / 2;
		posy = window.innerHeight / 2;
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

	handler?.show.subscribe((x) => {
		if (dialog === undefined) return;
		// console.log('show:', x);
		if (x && !dialog.open) {
			if (!dialog.open) {
				if (centerWhenOpen) makeCenter();
				if (modal) {
					frontend.states.modalOpenCounter++;
					dialog.showModal();
				}
				else dialog.show();
			}
		}
		if (!x && dialog.open){
			dialog.close();
		}
	});
</script>
	
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog
	bind:this={dialog}
	class={modal ? 'modal' : ''}
	style="top: {posy}px; left: {posx}px;"
	
	onclose={() => {
		if (modal)
			frontend.states.modalOpenCounter--;
		handler.show.set(false);
	}}
>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<header onmousedown={(ev) => startDrag(ev)}>
		{@render header?.()}
		<hr/>
	</header>
	<div>
		{@render children?.()}
	</div>
	<footer>
		<!-- svelte-ignore a11y_autofocus -->
		<button class='submit' autofocus 
			onclick={() => {
				handler.show.set(false); 
				handler.onSubmit?.();
			}}>done</button>
	</footer>
</dialog>

<style>
	dialog {
		max-width: 32em;
		border-radius: 0.3em;
		border: none;
		padding: 0;
		margin: 0;
		box-shadow: 0 0 10px gray;
		position: absolute;
		transform: translate(-50%, -50%);
		z-index: 100;
	}
	dialog.modal::backdrop {
		background: rgba(0, 0, 0, 0.3);
	}
	dialog > div {
		padding: 1em 1em 1em;
	}
	dialog[open] {
		animation: zoom 0.2s ease-out;
	}
	@keyframes zoom {
		from { transform: translate(-50%, -50%) scale(0.95); }
		to { transform: translate(-50%, -50%) scale(1); }
	}
	dialog.modal[open]::backdrop {
		animation: fade 0.2s ease-out;
	}
	@keyframes fade {
		from { opacity: 0; }
		to { opacity: 1; }
	}
	hr {
		border: 1px solid gray;
		margin: 10px 0 10px 0;
	}
	header {
		/* cursor: move; */
		padding: 0.5em 1em 1px;
		/* box-shadow: 0 -10px 10px 10px gray; */
	}
	footer {
		padding: 1em 1em 1em;
		text-align: right;
		background-color: rgb(226, 226, 226);
	}
	.submit {
		/* position: absolute; */
		padding: 6px;
	}
</style>

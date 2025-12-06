<script lang="ts" module>
import { type Component } from "svelte";

type DialogInstance<Args extends unknown[], Ret> = {
	id: number;
	component: DialogComponent<Args, Ret>;
	args: Args,
	resolve: (value: Ret) => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stack: DialogInstance<any, never>[] = $state([]);
let counter = 0;

export type DialogComponent<Args extends unknown[], Ret> = Component<{
  args: Args,
  close(ret: Ret): void
}>;

export async function openDialog<Args extends unknown[], Ret>(
  comp: DialogComponent<Args, Ret> | Promise<DialogComponent<Args, Ret>>, ...args: Args
) {
  const component = await comp;
  return new Promise<Ret>((resolve) => {
    stack.push({
      id: counter,
      component, args, resolve
    });
  });
}
</script>

{#each stack as instance, i (instance.id)}
  <instance.component
    args={instance.args}
    close={(ret) => {
      instance.resolve(ret);
      stack.splice(i, 1);
    }} />
{/each}
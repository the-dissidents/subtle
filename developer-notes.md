## Terribly Unintuitive Aspects of Svelte 5's Proxy-Based Reactivity

The `state_proxy_equality_mismatch` message reads: "Reactive `$state(...)` proxies and the values they proxy have different identities ..." But what does that mean? It means you just **can't** compare the reference equality between them. And note that objects and arrays are deeply reactive; consider:

```ts
let obj = {};
let obj_state = $state(obj);
let deep = $state({});

deep.value = obj;
console.log(deep.value == obj) // warning state_proxy_equality_mismatch; false
console.log($state.snapshot(deep.value) == obj) // false
console.log($state.snapshot(deep.value) == obj_state) // false
console.log($state.snapshot(deep.value) == $state.snapshot(obj_state)) // false

deep.value = obj_state;
console.log(deep.value == obj_state) // true
console.log($state.snapshot(deep.value) == obj) // false
console.log($state.snapshot(deep.value) == obj_state) // false
console.log($state.snapshot(deep.value) == $state.snapshot(obj_state)) // false
```

And `$state.snapshot` doesn't help here at all: it won't preserve the reference. Actually, it creates a clone of the object within the state (see [issue #15022](https://github.com/sveltejs/svelte/issues/15022)).

So, I repeat, you have **next to no way to** compare reference equality between a nonreactive object and 1) a reactive state, 2) a field in a deeply reactive object or 3) a member in a reactive array -- in roughly increasing order of unintuitiveness. Consider:

```js
let obj = {};
let reactive_array = $state([]);

reactive_array.push(obj);
console.log(reactive_array.indexOf(obj)); // state_proxy_equality_mismatch; -1
```

You can solve the problem only by making the object reactive first:

```js
let obj_state = $state(obj);
reactive_array.push(obj_state);
console.log(reactive_array.indexOf(obj_state)); // 1
```

... or immediately get the (now proxified) object from the array once it is pushed:

```js
reactive_array.push(obj);
obj = reactive_array.at(-1);
console.log(reactive_array.indexOf(obj)); // 2
```

... or use a SvelteSet instead, but that's not possible if item order matters.

It should really be better documented. I have a feeling that the Svelte documentations tend to focus on making everything look simple and easy to use, while unintuitive cases like this (which is likely where people will pull their hairs out in confusion) go without mention.

## Terribly Unintuitive Aspects of `$effect`

**"An effect only depends on the values that it read the last time it ran."**

Which means this -- the first version of the `hook` method in `PublicConfig` that I wrote -- won't work, because if when the effect runs for the first time `this.#initialized` isn't true, it won't run again anymore:

```typescript
hook<T>(track: () => T, action: (value: T) => void) {
    this.onInitialized(() => action(track()));

    $effect(() => {
        if (!this.#initialized) return;
        const value = track();
        untrack(() => action(value));
    });
}
```

As of writing (2025.4.23), there is a [pull request](https://github.com/sveltejs/svelte/pull/15069) to add a `$state.onchange` rune which removes this issue, and it looks like it will replace virtually all use cases of `$effect` in this project. I think it will be merged relatively soon.

## Template for Dialogs

```ts
<script lang="ts">
import DialogBase from '../DialogBase.svelte';
import { assert } from '../Basic';
import type { DialogHandler } from '../frontend/Dialogs';

import { _ } from 'svelte-i18n';

interface Props {
  handler: DialogHandler<void, /* return type here */>;
}
    
let {
  handler = $bindable(),
}: Props = $props();

let inner: DialogHandler<void> = {};
handler.showModal = async () => {
  assert(inner !== undefined);
  /* insert preparation here */
  let btn = await inner.showModal!();
  /* insert processing here */
  return /* result */;
}
</script>

<DialogBase handler={inner}>
  <!-- content here -->
</DialogBase>
```
import { Memorized } from "../config/MemorizedValue.svelte";
import { type SerializedSubtitleStyle, SubtitleStyle } from "../core/Subtitles.svelte";
import { Debug } from "../Debug";

class MemorizedStyles extends Memorized<SerializedSubtitleStyle[], SubtitleStyle[]> {
    constructor(protected key: string) {
        super(key, []);
    }
    protected get type(): string {
        return 'MemorizedStyles';
    }
    protected serialize() {
        return this.value.map((x) => SubtitleStyle.serialize(x));
    }
    protected deserialize(value: unknown): void {
        if (!Array.isArray(value)) {
            void Debug.warn('unable to deserialize styles');
            return;
        }
        this.value = value.flatMap((x) => {
            try {
                return [SubtitleStyle.deserializeWithoutSpecial(x)];
            } catch (e) {
                void Debug.warn('unable to deserialize style', x, e);
                return [];
            }
        });
    }
}

export const SavedStyles = new MemorizedStyles('savedStyles');

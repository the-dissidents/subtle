// Written by Gemini-2.5-Pro-Exp

/**
 * Convert `KeyboardEvent.code` to Tauri key code
 */
export const KeyCodeMap = {
    // Alphanumeric keys (preferring single char)
    KeyA: 'A',
    KeyB: 'B',
    KeyC: 'C',
    KeyD: 'D',
    KeyE: 'E',
    KeyF: 'F',
    KeyG: 'G',
    KeyH: 'H',
    KeyI: 'I',
    KeyJ: 'J',
    KeyK: 'K',
    KeyL: 'L',
    KeyM: 'M',
    KeyN: 'N',
    KeyO: 'O',
    KeyP: 'P',
    KeyQ: 'Q',
    KeyR: 'R',
    KeyS: 'S',
    KeyT: 'T',
    KeyU: 'U',
    KeyV: 'V',
    KeyW: 'W',
    KeyX: 'X',
    KeyY: 'Y',
    KeyZ: 'Z',
    Digit0: '0',
    Digit1: '1',
    Digit2: '2',
    Digit3: '3',
    Digit4: '4',
    Digit5: '5',
    Digit6: '6',
    Digit7: '7',
    Digit8: '8',
    Digit9: '9',

    // Symbol keys (preferring single char)
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',

    // Whitespace & Control keys
    Enter: 'Enter',
    Tab: 'Tab',
    Space: 'Space',
    Backspace: 'Backspace',
    Escape: 'Escape',

    // Navigation & Editing keys
    Delete: 'Delete', // Corresponds to ForwardDelete (kVK_ForwardDelete) on macOS
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert', // kVK_Help maps to Insert in Chromium, Tauri supports Insert


    // Arrow keys (preferring short names)
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',

    // Function keys
    F1: 'F1',
    F2: 'F2',
    F3: 'F3',
    F4: 'F4',
    F5: 'F5',
    F6: 'F6',
    F7: 'F7',
    F8: 'F8',
    F9: 'F9',
    F10: 'F10',
    F11: 'F11',
    F12: 'F12',
    F13: 'F13',
    F14: 'F14',
    F15: 'F15',
    F16: 'F16',
    F17: 'F17',
    F18: 'F18',
    F19: 'F19',
    F20: 'F20',
    F21: 'F21', // Assuming support based on pattern
    F22: 'F22', // Assuming support based on pattern
    F23: 'F23', // Assuming support based on pattern
    F24: 'F24', // Assuming support based on pattern


    // Numpad keys (preferring short names like NUM*)
    NumLock: 'NumLock', // Note: kVK_ANSI_KeypadClear maps to NumLock
    Numpad0: 'Num0',
    Numpad1: 'Num1',
    Numpad2: 'Num2',
    Numpad3: 'Num3',
    Numpad4: 'Num4',
    Numpad5: 'Num5',
    Numpad6: 'Num6',
    Numpad7: 'Num7',
    Numpad8: 'Num8',
    Numpad9: 'Num9',
    NumpadAdd: 'NumAdd', // Or NumPlus, NumAdd is shorter
    NumpadSubtract: 'NumSubtract',
    NumpadMultiply: 'NumMultiply',
    NumpadDivide: 'NumDivide',
    NumpadDecimal: 'NumDecimal',
    NumpadEnter: 'NumEnter',
    NumpadEqual: 'NumEqual',
    // NumpadComma: 'NumpadComma', // Present in JS codes, but not explicitly listed in Tauri parser? Check Tauri docs if needed. Assuming unsupported for now based only on provided Rust code.
    // Media keys (preferring shorter names)
    // Mapping both Firefox and Chromium variants where applicable
    VolumeDown: 'VolumeDown',
    AudioVolumeDown: 'VolumeDown',
    VolumeUp: 'VolumeUp',
    AudioVolumeUp: 'VolumeUp',
    VolumeMute: 'VolumeMute',
    AudioVolumeMute: 'VolumeMute',
    MediaPlayPause: 'MediaPlayPause',
    // MediaPlay: 'MediaPlay', // Explicitly listed in Tauri parser
    // MediaPause: 'MediaPause', // Explicitly listed in Tauri parser
    MediaStop: 'MediaStop',
    MediaTrackNext: 'MediaTrackNext',
    MediaTrackPrevious: 'MediaTrackPrev', // Shortest alias


    // Other keys supported by Tauri parser
    PrintScreen: 'PrintScreen',
    ScrollLock: 'ScrollLock',
    // ContextMenu: 'ContextMenu', // Present in JS codes, not in Tauri parser
} as const;

export type KeyCode = (typeof KeyCodeMap)[keyof typeof KeyCodeMap];
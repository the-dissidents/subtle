
export const LABEL_TYPES = ['none', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type LabelType = (typeof LABEL_TYPES)[number];

export enum AlignMode {
    BottomLeft = 1, BottomCenter, BottomRight,
    CenterLeft, Center, CenterRight,
    TopLeft, TopCenter, TopRight
}

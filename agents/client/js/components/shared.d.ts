/** What the service reads from the small face's rule, so a summary is held to the lines a note's face gives it. */
export declare const HEIGHT: number;
export declare const FRAME: number;
export declare const COLUMN: number;
export declare const TITLE: number;
export declare const TEXT: number;
export declare const GAP: number;
export declare function linesOf(str: string, column: number, measure: 'title' | 'head' | 'body' | 'meta' | 'passage'): number;

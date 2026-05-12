export interface ParsedStack {
	frames: Array<StackFrame>;
	message: string;
}

interface StackFrame {
	column?: number;
	dataModelPath: string;
	line: number;
}

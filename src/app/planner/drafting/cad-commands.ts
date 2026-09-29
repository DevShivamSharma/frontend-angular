/**
 * The command table: every command, its AutoCAD-style aliases and where it shows in the ribbon.
 * Standard aliases keep their AutoCAD meaning; stall commands follow AutoCAD's naming style.
 */

export type CommandName =
  | 'STALL' | 'STALLROW' | 'ISLAND' | 'ARRAY' | 'SPLIT' | 'MERGE' | 'RENUMBER' | 'OPENSIDE'
  | 'MOVE' | 'COPY' | 'ROTATE' | 'MIRROR' | 'ERASE' | 'MATCHPROP' | 'PROPERTIES'
  | 'UNDO' | 'REDO' | 'DIST' | 'AREA' | 'ID' | 'ZOOM' | 'PAN' | 'SELECTALL'
  | 'CHECK' | 'ASSIST' | 'PDFPLOT' | 'QSAVE' | 'EXPORT' | 'HELP';

export interface CommandInfo {
  name: CommandName;
  aliases: readonly string[];
  /** What the command does, in one line (tooltips and HELP). */
  help: string;
  /** Changes the drawing (so it can be undone). */
  edits: boolean;
}

export const COMMANDS: readonly CommandInfo[] = [
  { name: 'STALL', aliases: ['STL'], help: 'Place stalls of the current size, one per click', edits: true },
  { name: 'STALLROW', aliases: ['SR'], help: 'Draw an aisle edge; it fills with stalls that open onto it', edits: true },
  { name: 'ISLAND', aliases: ['ISL'], help: 'Box an island: stalls back to back with aisles all round', edits: true },
  { name: 'ARRAY', aliases: ['AR'], help: 'Rectangular array of the selected stalls', edits: true },
  { name: 'SPLIT', aliases: ['SPL'], help: 'Divide a stall into equal parts', edits: true },
  { name: 'MERGE', aliases: ['MRG'], help: 'Merge neighbouring stalls into one', edits: true },
  { name: 'RENUMBER', aliases: ['RN'], help: 'Name stalls in order: by rows, columns, snake or picking', edits: true },
  { name: 'OPENSIDE', aliases: ['OS'], help: 'Click stall edges to open or close them to the aisle', edits: true },
  { name: 'MOVE', aliases: ['M'], help: 'Move with a base point and a second point', edits: true },
  { name: 'COPY', aliases: ['CO', 'CP'], help: 'Copy with a base point; repeats until Enter', edits: true },
  { name: 'ROTATE', aliases: ['RO'], help: 'Rotate about a base point', edits: true },
  { name: 'MIRROR', aliases: ['MI'], help: 'Mirror in a line', edits: true },
  { name: 'ERASE', aliases: ['E', 'DEL'], help: 'Erase; a saved stall is cancelled and keeps its number', edits: true },
  { name: 'MATCHPROP', aliases: ['MA'], help: 'Copy colour, height and open sides from one stall to others', edits: true },
  { name: 'PROPERTIES', aliases: ['PR', 'CH'], help: 'Show the properties palette', edits: false },
  { name: 'UNDO', aliases: ['U'], help: 'Undo the last command (Ctrl+Z)', edits: false },
  { name: 'REDO', aliases: [], help: 'Redo (Ctrl+Y)', edits: false },
  { name: 'DIST', aliases: ['DI'], help: 'Distance and angle between two points', edits: false },
  { name: 'AREA', aliases: ['AA'], help: 'Area and perimeter of picked points or a stall', edits: false },
  { name: 'ID', aliases: [], help: 'Coordinates of a point', edits: false },
  { name: 'ZOOM', aliases: ['Z'], help: 'Zoom: Extents, Window or Selection', edits: false },
  { name: 'PAN', aliases: ['P'], help: 'Drag to pan (the middle button pans at any time)', edits: false },
  { name: 'SELECTALL', aliases: ['ALL'], help: 'Select every stall (Ctrl+A)', edits: false },
  { name: 'CHECK', aliases: ['CHK'], help: 'Run every rule and step through the issues', edits: false },
  { name: 'ASSIST', aliases: ['AI'], help: 'Describe stalls in words; review the proposal on the canvas', edits: true },
  { name: 'PDFPLOT', aliases: ['PP'], help: "Read the stalls from an architect's CAD PDF", edits: true },
  { name: 'QSAVE', aliases: ['SAVE', 'QS'], help: 'Save the layout (Ctrl+S)', edits: false },
  { name: 'EXPORT', aliases: ['EXP'], help: 'Export the stalls for the Fabric.js booking portal', edits: false },
  { name: 'HELP', aliases: ['?'], help: 'List the commands', edits: false }
];

const BY_WORD = new Map<string, CommandInfo>();
for (const c of COMMANDS) {
  BY_WORD.set(c.name, c);
  for (const a of c.aliases) BY_WORD.set(a, c);
}

export function findCommand(word: string): CommandInfo | null {
  return BY_WORD.get(word.trim().toUpperCase()) ?? null;
}

export function commandInfo(name: CommandName): CommandInfo {
  return COMMANDS.find(c => c.name === name)!;
}

/** "Command (alias)" for tooltips, e.g. "Stall row (SR)". */
export function aliasOf(name: CommandName): string {
  return commandInfo(name).aliases[0] ?? name;
}

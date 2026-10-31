import { defaultCometLayout, wirePath } from './comet-layout.ts';

function register(id: string, label: string, x: number, y: number, width = 90) {
  return `<g id="node-${id}" class="datapath-node"><text class="node-label" x="${x}" y="${y-9}">${label}</text><rect x="${x}" y="${y}" width="${width}" height="36" rx="3"/><text class="node-value" id="value-${id}" x="${x+width/2}" y="${y+24}" text-anchor="middle">—</text></g>`;
}

export function cometDiagramMarkup():string {
  return `<svg class="datapath" viewBox="0 0 620 438" role="img" aria-labelledby="datapath-title">
        <desc id="datapath-title">COMET CPUのレジスタ、制御部、加算器、ALUと転送経路</desc>
        <defs><marker id="bus-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z"/></marker></defs>
        <g class="bus-lines">${defaultCometLayout.wires.map(wire=>`<path data-wire-id="${wire.id}" data-from="${wire.from}" data-to="${wire.to}" d="${wirePath(defaultCometLayout,wire.id)}"/>`).join('')}</g>
        <g id="node-ir" class="datapath-node"><text class="node-label" x="30" y="38">IR</text><rect x="30" y="48" width="168" height="36" rx="3"/><path class="node-divider" d="M114 48V84"/><text id="value-ir1" class="node-value" x="72" y="72" text-anchor="middle">—</text><text id="value-ir2" class="node-value" x="156" y="72" text-anchor="middle">—</text></g>
        <g id="node-decoder" class="datapath-node"><rect x="30" y="124" width="168" height="120" rx="4"/><text class="node-label" x="42" y="146">Decoder</text><text class="node-caption" x="42" y="167">OP</text><text id="value-opcode" class="node-value small-value" x="76" y="167">—</text><text class="node-caption" x="112" y="167">ADR</text><text id="value-adr" class="node-value small-value" x="146" y="167">—</text><text class="node-caption" x="48" y="192">r</text><text class="node-caption" x="126" y="192">x</text><rect class="decoder-field" x="42" y="199" width="66" height="30" rx="2"/><rect class="decoder-field" x="119" y="199" width="67" height="30" rx="2"/><text id="value-r" class="node-value" x="75" y="221" text-anchor="middle">—</text><text id="value-x" class="node-value" x="152" y="221" text-anchor="middle">—</text></g>
        <g id="node-controller" class="datapath-node"><rect x="30" y="274" width="168" height="78" rx="4"/><text class="node-label" x="42" y="297">Controller</text><text id="value-controller" class="controller-value" x="42" y="326">—</text></g>
        ${register('pr','PR',238,48,88)}${register('sp','SP',238,92,88)}
        <g id="node-gr" class="datapath-node register-bank"><text class="node-label" x="238" y="148">GR</text><rect x="238" y="160" width="88" height="216" rx="3"/>${Array.from({length:8},(_,i)=>`<g id="gr-row-${i}" class="gr-row"><rect x="239" y="${161+i*27}" width="86" height="26"/><text class="gr-index" x="249" y="${180+i*27}">${i}</text><text class="node-value" id="comet-gr-${i}" x="317" y="${180+i*27}" text-anchor="end">—</text></g>`).join('')}</g>
        ${register('mar','MAR',456,24)}
        <g id="node-adder" class="datapath-node"><path class="logic-shape" d="M386 128L408 136L430 148V162L408 174L386 182V162L397 155L386 148Z"/><text class="node-label" x="386" y="203">Adder</text></g>
        ${register('ea','EA',456,140)}${register('mdr','MDR',490,244)}
        <g id="node-alu" class="datapath-node"><path class="logic-shape" d="M390 310H432L460 341L488 310H530V358L495 390H425L390 358Z"/><text class="logic-label" x="460" y="368" text-anchor="middle">ALU</text></g>
        <g id="node-fr" class="datapath-node"><text class="node-label" x="335" y="330">FR</text><rect x="335" y="340" width="45" height="33" rx="3"/><text id="value-fr" class="node-value" x="357" y="363" text-anchor="middle">—</text><text class="node-caption" x="335" y="391">O S Z</text></g>
        <g id="node-memory" class="memory-port"><text class="node-caption" x="570" y="231">MEM</text><circle cx="606" cy="210" r="3"/><circle cx="606" cy="260" r="3"/><circle cx="606" cy="274" r="3"/></g>
      </svg>`;
}

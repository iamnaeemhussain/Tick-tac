/**
 * The 3×3 board — high-contrast cells, big touch targets, winning-line
 * overlay, hover ghost preview, and full keyboard/screen-reader support.
 */

import { Board as BoardT, Mark as MarkT } from '../../shared/game';
import { Mark } from './Marks';

export interface BoardProps {
	board: BoardT;
	/** Your mark for the hover ghost preview (only when it's your turn). */
	ghostMark: MarkT | null;
	winLine: [number, number, number] | null;
	lastMove: number | null;
	/** Cell click handler; pass null to disable the whole board. */
	onCell: ((cell: number) => void) | null;
	disabledCells?: boolean;
	/** While true, plays the shake animation (e.g. on a rejected move). */
	shake?: boolean;
}

function cellLabel(board: BoardT, i: number): string {
	const row = Math.floor(i / 3) + 1;
	const col = (i % 3) + 1;
	const v = board[i];
	return `Row ${row}, column ${col}: ${v ? v : 'empty'}`;
}

export function Board({ board, ghostMark, winLine, lastMove, onCell, shake }: BoardProps) {
	const lineCoords = winLine
		? winLine.map((c) => ({ x: (c % 3) + 0.5, y: Math.floor(c / 3) + 0.5 }))
		: null;

	return (
		<div className={`board-wrap${shake ? ' shake' : ''}`} data-testid="board">
			<div className="board" role="grid" aria-label="Tic-Tac-Toe board">
				{board.map((cell, i) => {
					const interactive = onCell !== null && cell === null;
					return (
						<button
							key={i}
							type="button"
							role="gridcell"
							className={[
								'cell',
								cell ? `filled filled-${cell.toLowerCase()}` : '',
								lastMove === i ? 'last-move' : '',
								winLine?.includes(i) ? 'win-cell' : '',
							]
								.filter(Boolean)
								.join(' ')}
							aria-label={cellLabel(board, i)}
							disabled={!interactive}
							data-ghost={interactive && ghostMark ? ghostMark : undefined}
							onClick={() => onCell?.(i)}
						>
							{cell && <Mark value={cell} />}
							{!cell && interactive && ghostMark && (
								<span className="ghost-holder">
									<Mark value={ghostMark} ghost />
								</span>
							)}
						</button>
					);
				})}
			</div>
			{lineCoords && (
				<svg className="win-line" viewBox="0 0 3 3" aria-hidden="true" focusable="false">
					<line
						x1={lineCoords[0].x}
						y1={lineCoords[0].y}
						x2={lineCoords[2].x}
						y2={lineCoords[2].y}
					/>
				</svg>
			)}
		</div>
	);
}

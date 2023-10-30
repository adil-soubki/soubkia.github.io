const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
document.addEventListener("keydown", onKeyDown);
document.addEventListener("keyup", onKeyUp);
setInterval(loop, 20);


const Piece = {
  FROG: "frog",
  TOAD: "toad",
  EMPTY: "empty"
}


let state = {
  keys: {
    right: false,
    left: false,
    enter: false,
  },
  board: [
    Piece.FROG,
    Piece.FROG,
    Piece.EMPTY,
    Piece.EMPTY,
    Piece.EMPTY,
    Piece.EMPTY,
    Piece.TOAD,
    Piece.TOAD,
  ],
  cursor: {
    idx: 1,
  },
  turn: 0,
}


const cfg = {
  cellWidth: 30,
  cellHeight: 30,
  cellPadding: 10,
  cmap: {
    [Piece.FROG]: "#009500",
    [Piece.TOAD]: "#0095DD",
    [Piece.EMPTY]: "#BBB",
    cursor: "#000",
  }
}
const initialState = structuredClone(state);


// ========== Key Handlers ========== //


function onKeyDown(evt) {
  if (evt.key === "Right" || evt.key === "ArrowRight") {
    state.keys.right = true;
  }
  if (evt.key === "Left" || evt.key === "ArrowLeft") {
    state.keys.left = true;
  }
  if (evt.key === "Enter") {
    state.keys.enter = true;
  }
}


function onKeyUp(evt) {
  if (evt.key === "Right" || evt.key === "ArrowRight") {
    state.keys.right = false;
  }
  if (evt.key === "Left" || evt.key === "ArrowLeft") {
    state.keys.left = false;
  }
  if (evt.key === "Enter") {
    state.keys.enter = false;
  }
}


function resetPressedKeys() {
  for (const key in state.keys) {
    state.keys[key] = false;
  }
}


// ========== Render Logic ========== //


function drawCell(idx) {
  y = (canvas.height / 2) - (cfg.cellHeight / 2);
  xStart = (canvas.width - (cfg.cellWidth + cfg.cellPadding) * state.board.length) / 2;
  x = xStart + (cfg.cellWidth + cfg.cellPadding) * idx;
  ctx.beginPath();
  ctx.rect(x, y, cfg.cellWidth, cfg.cellHeight);
  ctx.fillStyle = cfg.cmap[state.board[idx]];
  ctx.fill()
  ctx.closePath();
}


function drawBoard() {
  for (let i = 0; i < state.board.length; i++) {
    drawCell(i);
  }
}


function drawCursor() {
  y = (canvas.height / 2) - (cfg.cellHeight / 2) + (cfg.cellHeight / 2);
  xStart = (canvas.width - (cfg.cellWidth + cfg.cellPadding) * state.board.length) / 2;
  x = xStart + (cfg.cellWidth + cfg.cellPadding) * state.cursor.idx + (cfg.cellWidth / 2);
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, 2 * Math.PI);
  ctx.fillStyle = cfg.cmap.cursor;
  ctx.fill()
  ctx.closePath();
}


// ========== Game Logic ========== //


function getMovableIndex(idx) {
  if (state.board[idx] === Piece.EMPTY) {
    return idx;
  } else if (!((state.board[idx] === Piece.FROG) || (state.board[idx] === Piece.TOAD))) {
    console.error(`Unknown Piece: ${state.board[idx]}`);
  }

  const one = state.board[idx] === Piece.FROG ?
    Math.min(idx + 1, state.board.length - 1) :
    Math.max(idx - 1, 0);
  const two = state.board[idx] === Piece.FROG ?
    Math.min(idx + 2, state.board.length - 1) :
    Math.max(idx - 2, 0);
  const enemy = state.board[idx] === Piece.FROG ? Piece.TOAD : Piece.FROG;

  if (state.board[one] === Piece.EMPTY) {
    return one;
  } else if (state.board[one] === enemy && state.board[two] === Piece.EMPTY) {
    return two;
  } else {
    return idx;
  }
}


function getMovableIndices() {
  const player = state.turn % 2 === 0 ? Piece.FROG : Piece.TOAD;
  return state.board.reduce((ret, elem, idx) => {
    if ((elem === player) && (getMovableIndex(idx) !== idx)) {
      ret.push(idx);
    }
    return ret;
  }, []);
}


function moveCursorPiece() {
  const cdx = state.cursor.idx;
  const mdx = getMovableIndex(state.cursor.idx);
  if (cdx !== mdx) {
    state.board[mdx] = state.board[cdx];
    state.board[cdx] = Piece.EMPTY;
  }
  state.turn++;
  if (getMovableIndices().length > 0) {
    state.cursor.idx = getMovableIndices()[0];
  } else {
    const winner = state.turn % 2 === 0 ? Piece.TOAD : Piece.FROG;
    alert(`${winner}s win!`);
    state = structuredClone(initialState);
  }
}


function loop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const movableIndices = getMovableIndices();
  if (state.keys.right) {
    state.cursor.idx = movableIndices.find(idx => idx > state.cursor.idx) != null ?
      movableIndices.find(idx => idx > state.cursor.idx) :
      state.cursor.idx;
  } else if (state.keys.left) {
    state.cursor.idx = movableIndices.find(idx => idx < state.cursor.idx) != null ?
      movableIndices.find(idx => idx < state.cursor.idx) :
      state.cursor.idx;
  } else if (state.keys.enter) {
    moveCursorPiece();
  }

  drawBoard();
  drawCursor()
  resetPressedKeys();
}

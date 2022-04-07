/* eslint-disable no-plusplus */
const range = (len: number) => {
  const arr = [];
  for (let i = 0; i < len; i++) {
    arr.push(i);
  }
  return arr;
};

const newTree = () => {
  return {
    tag: Math.floor(Math.random() * 99999 + 10000),
    subquadrat: Math.floor(Math.random() * 100),
    spcode: 'protte',
  };
};

interface Tree {
  subRows: Tree[] | undefined;
  tag: number;
  subquadrat: number;
  spcode: string;
}
export default function makeData(...lens: number[]) {
  function makeDataLevel(depth = 0) {
    function makeTree(): Tree {
      return {
        ...newTree(),
        subRows: lens[depth + 1] ? makeDataLevel(depth + 1) : undefined,
      };
    }
    const len = lens[depth];
    return range(len).map(makeTree);
  }
  return makeDataLevel();
}

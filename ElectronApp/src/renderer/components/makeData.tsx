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

export default function makeData(...lens: number[]) {
  const makeDataLevel = (depth = 0) => {
    const len = lens[depth];
    return range(len).map(() => {
      return {
        ...newTree(),
        subRows: lens[depth + 1] ? makeDataLevel(depth + 1) : undefined,
      };
    });
  };

  return makeDataLevel();
}

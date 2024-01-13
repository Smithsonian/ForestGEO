"use client";

// export const PlotSelection = () => {
//   const {status} = useSession();
//   const dispatch = usePlotDispatch();
//   const currentPlot = usePlotContext();
//   // const [plots, setPlots] = useState<Plot>();
//   const [value, setValue] = useState<string>(currentPlot ? currentPlot!.key : "");
//   useEffect(() => {
//     if (dispatch && value != currentPlot!.key) {
//       dispatch({
//         plot: value,
//       });
//     }
//   }, [dispatch, value]);
//   const keys = plots.map(plot => {
//     return {
//       key: plot.key
//     };
//   });
//   const handleChange = (
//     event: React.SyntheticEvent | null,
//     newValue: string | null,
//   ) => {
//     setValue(newValue!);
//   };
//   return (
//     <>
//       <Select size={"md"} onChange={handleChange} placeholder={"Select a plot:"}>
//         {keys.map((keyItem, keyIndex) => (
//           <Option key={keyIndex} value={keyItem.key}>{keyItem.key}</Option>
//         ))}
//       </Select>
//     </>
//   );
// }
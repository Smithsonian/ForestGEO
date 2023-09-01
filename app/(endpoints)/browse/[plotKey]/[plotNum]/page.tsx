"use client";
import React, {useCallback, Dispatch, SetStateAction, useState, useEffect} from 'react';
import {
	Table,
	TableHeader,
	TableBody,
	TableColumn,
	TableRow,
	TableCell,
	CircularProgress,
	Button,
} from '@nextui-org/react';
import {DownloadIcon, DeleteIcon, EditIcon} from "@/components/icons";
import {fileColumns, Plot} from "@/config/site";
import Grid from '@mui/joy/Grid';
import Box from '@mui/joy/Box';
import {Typography} from "@mui/joy";
import {useSession} from "next-auth/react";
import {title} from "@/components/primitives";

// @todo: look into using an ID other than plot name.
// @todo: react router URL params to pass in the ID for Browse.
//        https://reactrouter.com/en/main/start/tutorial#url-params-in-loaders

/**
 * Keyed by csv filename, valued by date and user that uploaded it.
 */
interface PlotRows {
	[fileName: string]: {
		date: string;
		user: string;
	};
}

interface BrowsePureProps {
	plot: Plot;
	setPlot: Dispatch<SetStateAction<Plot>>;
	error?: Error;
	/** True when plot data has finished loading. */
	isLoaded: boolean;
	/** All the rows of data for the plot. */
	plotRows?: PlotRows;
}
export default function Page({ params }: { params: { plotKey: string, plotNum: string } }) {
	useSession({
		required: true,
		onUnauthenticated() {
			return (
				<>
					<h3 className={title()}>You must log in to view this page.</h3>
				</>
			);
		},
	});
	let localPlot: Plot = {
		key: (params.plotKey === 'none') ? '' : params.plotKey,
		num: parseInt(params!.plotNum)
	};
	const [currentPlot, setCurrentPlot] = useState(localPlot);
	// @TODO - implement remove and download files
	
	const [error, setError] = useState<Error>();
	const [isLoaded, setIsLoaded] = useState(false);
	const [plotRows, setRows] = useState<PlotRows>();
	
	const getListOfFiles = useCallback(async () => {
		if (currentPlot && currentPlot.key !== undefined) {
			let response = null;
			try {
				response = await fetch('/api/download?plot=' + currentPlot.key, {
					method: 'Get',
				});
				
				if (!response.ok) {
					console.error('response.statusText', response.statusText);
					setError(new Error('API response not ok'));
				}
			} catch (e) {
				console.error(e);
				setError(new Error('API response not ok'));
			}
			
			if (response) {
				const data = await response.json();
				setRows(data);
				setIsLoaded(true);
			}
		} else {
			console.log('Plot is undefined');
			setError(new Error('No plot'));
		}
	}, [currentPlot]);
	
	useEffect(() => {
		getListOfFiles();
	}, [getListOfFiles]);
	
	useEffect(() => {
		setCurrentPlot(currentPlot);
		setIsLoaded(true);
		setError(undefined);
	}, [currentPlot, setCurrentPlot, error, isLoaded]);
	
	if ((!currentPlot || !currentPlot.key) || (currentPlot.key === 'none' || currentPlot.num === 0)) {
		return (
			<>
				<h1 className={title()}>Please select a plot to continue.</h1>
			</>
		);
	} else {
		return (
			<BrowsePure
				plot={currentPlot}
				setPlot={setCurrentPlot}
				error={error}
				plotRows={plotRows}
				isLoaded={isLoaded}
			/>
		);
	}
}

/**
 * A container for layout.
 */
function Container({ children }: { children?: React.ReactNode }) {
	return (
		<Grid
			container
			direction="column"
			sx={{
				marginTop: 20,
				justifyContent: 'center',
				alignItems: 'center',
			}}
		>
			<Box
				sx={{
					fontWeight: 'bold',
					fontSize: 35,
					marginBottom: 30,
				}}
			>
				{children}
			</Box>
		</Grid>
	);
}

/**
 * Allows selecting from a list of plots, then shows the data for that plot.
 */
function BrowsePure({error, isLoaded, plotRows, plot}: BrowsePureProps) {
	if (!plot.key) {
		return (
			<Container>
				<Typography level="h2" mt={2}>
					Please select plot
				</Typography>
			</Container>
		);
	} else if (error) {
		return (
			<Container>
				<Typography level="h2" mt={2}>
					Error while loading data.
				</Typography>
				<Typography mt={2} mb={2}>
					Perhaps try reloading the page. If it still doesn&apos;t work, please again
					a bit later.
				</Typography>
			</Container>
		);
	} else if (!isLoaded || !plotRows) {
		return (
			<Container>
				<Typography level="h2" mt={2}>
					Loading Files...
				</Typography>
				<CircularProgress value={60} size={"lg"}></CircularProgress>
			</Container>
		);
	} else {
		return (
			<>
				<Typography level="h2" mt={2}>
					Files for `${plot.key}`
				</Typography>
				<Grid
					container
					direction="row"
					sx={{
						marginTop: 10,
						justifyContent: 'center',
						alignItems: 'center',
					}}
				>
					<Table aria-label="simple table"
						className={"max-h-fit max-w-fit border-solid border-emerald-400 rounded-sm "}>
						<TableHeader>
							<TableHeader className={"font-bold"} columns={fileColumns}>
								{(column) => <TableColumn key={column.key}>{column.label}</TableColumn>}
							</TableHeader>
						</TableHeader>
						<TableBody>
							{Object.keys(plotRows).map((fileName) => {
								return (
									<TableRow key={fileName}>
										<TableCell>{fileName}</TableCell>
										<TableCell>{plotRows[fileName].date}</TableCell>
										<TableCell>{plotRows[fileName].user}</TableCell>
										<TableCell align={"center"}>
											<Button>
												<DownloadIcon />
											</Button>
											<Button>
												<EditIcon />
											</Button>
											<Button onClick={() => console.log('trying to delete file')}>
												<DeleteIcon />
											</Button>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</Grid>
			</>
		);
	}
}
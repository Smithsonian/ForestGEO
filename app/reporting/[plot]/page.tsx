import { title } from "@/components/primitives";

export default function Page({ params }: { params: { plot: string } }) {
	return (
		<div>
			<h1 className={title()}>Reporting</h1>
			<p>Currently selected: {params.plot}</p>
		</div>
	);
}

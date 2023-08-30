import {subtitle} from "@/components/primitives";
import * as React from "react";

export default function Page({ params }: { params: { plot: string } }) {
	return (
		<>
			<p className={subtitle()}>Currently at validation page, viewing {params ? params?.plot : ""}</p>
		</>
	);
}

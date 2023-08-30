"use client";
import * as React from "react";
import {subtitle, title} from "@/components/primitives";

export default function Page() {
	return (
		<section className="flex flex-col items-center justify-center gap-4 py-8 md:py-10">
			<h1 className={title()}>Welcome to &nbsp;</h1>
			<br />
			<h1 className={title({color: "violet"})}>ForestGEO&nbsp;</h1>
			<br/>
			<h2 className={subtitle({class: "mt-4"})}>
				A data entry and validation system for your convenience.
			</h2>
		</section>
	);
}

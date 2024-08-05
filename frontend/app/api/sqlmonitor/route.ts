import { poolMonitor } from "@/components/processors/processormacros";
import { HTTPResponses } from "@/config/macros";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const status = poolMonitor.getPoolStatus();
    return NextResponse.json({ message: "Monitoring check successful ", status }, { status: HTTPResponses.OK });
  } catch (error: any) {
    // If there's an error in getting the pool status
    console.error("Error in pool monitoring:", error);
    return NextResponse.json({ message: "Monitoring check failed", error: error.message }, { status: 500 });
  }
}

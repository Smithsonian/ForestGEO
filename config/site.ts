export interface Plot {
  key: string;
  num: number;
}

export const plots: Plot[] = [
  { key: "Amacayacu", num: 16 },
  { key: "BCI", num: 40 },
  { key: "bukittimah", num: 22 },
  { key: "Cocoli", num: 39 },
  { key: "CRC", num: 1 },
  { key: "CTFS-Panama", num: 11 },
  { key: "Danum", num: 36 },
  { key: "Harvard Forest", num: 9 },
  { key: "Heishiding", num: 4 },
  { key: "HKK", num: 19 },
  { key: "ituri_all", num: 24 },
  { key: "khaochong", num: 38 },
  { key: "Korup", num: 10 },
  { key: "korup3census", num: 32 },
  { key: "Lambir", num: 35 },
  { key: "Lilly_Dickey", num: 41 },
  { key: "Luquillo", num: 25 },
  { key: "Mpala", num: 3 },
  { key: "osfdp", num: 37 },
  { key: "pasoh", num: 15 },
  { key: "Rabi", num: 17 },
  { key: "Scotty Creek", num: 8 },
  { key: "SERC", num: 7 },
  { key: "Sinharaja", num: 26 },
  { key: "Speulderbos", num: 29 },
  { key: "Stable_bukittimah", num: 27 },
  { key: "stable_pasoh", num: 28 },
  { key: "Traunstein", num: 34 },
  { key: "Tyson", num: 23 },
  { key: "UMBC", num: 18 },
  { key: "Utah", num: 30 },
  { key: "Vandermeer", num: 14 },
  { key: "wanang", num: 21 },
  { key: "Yosemite", num: 33 },
]
export const siteConfig = {
	name: "ForestGEO",
	description: "Census data entry and validation",
	navItems: [
		{
			label: "Home",
			href: "/",
		},
    {
      label: "Browse",
      href: "/browse",
    },
    {
      label: "Reporting",
      href: "/reporting",
    },
    {
      label: "Validation",
      href: "/validation",
    }
	]
};

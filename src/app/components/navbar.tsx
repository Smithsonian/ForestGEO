"use client";
import Link from "next/link";
import React, {useState} from "react";
import NavItem from "@/app/components/navitem";
import SelectPlot from "@/app/components/plotselection";

const MENU_LIST = [
  {text: "Home", href: "/"},
  {text: "Browse", href: "/browse"},
  {text: "Reporting", href: "/reporting"},
  {text: "Validation", href: "/validation"},
];

const PLOT_SELECTIONS = [
  { key: "Amacayacu" },
  { key: "BCI" },
  { key: "bukittimah" },
  { key: "Cocoli" },
  { key: "CRC" },
  { key: "CTFS-Panama" },
  { key: "Danum" },
  { key: "Harvard Forest" },
  { key: "Heishiding" },
  { key: "HKK" },
  { key: "ituri_all" },
  { key: "khaochong" },
  { key: "Korup" },
  { key: "korup3census" },
  { key: "Lambir" },
  { key: "Lilly_Dickey" },
  { key: "Luquillo" },
  { key: "Mpala" },
  { key: "osfdp" },
  { key: "pasoh" },
  { key: "Rabi" },
  { key: "Scotty Creek" },
  { key: "SERC" },
  { key: "Sinharaja" },
  { key: "Speulderbos" },
  { key: "Stable_bukittimah" },
  { key: "stable_pasoh" },
  { key: "Traunstein" },
  { key: "Tyson" },
  { key: "UMBC" },
  { key: "Utah" },
  { key: "Vandermeer" },
  { key: "wanang" },
  { key: "Yosemite" },
];

const NavBar = () => {
  const [navActive, setNavActive] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [selectedPlot, setSelectedPlot] = useState("");
  
  return (
    <header>
      <nav className={`nav`}>
        <div>
          <Link href={"/"} className={"logo"}>ForestGEO</Link>
          <div onClick={() => setNavActive(!navActive)} className={`nav__menu-bar`}>
            <div></div>
            <div></div>
            <div></div>
          </div>
          <div className={`${navActive ? "active" : ""} nav__menu-list`}>
            {MENU_LIST.map((menu, idx) => (
              <div
                onClick={() => {
                  setActiveIdx(idx);
                  setNavActive(false);
                }}
                key={menu.text}
              >
                <NavItem active={activeIdx === idx} {...menu} />
              </div>
            ))}
          </div>
          <div>
            <SelectPlot setSelection={setSelectedPlot} />
          </div>
        </div>
      </nav>
    </header>
  );
}

export default NavBar;
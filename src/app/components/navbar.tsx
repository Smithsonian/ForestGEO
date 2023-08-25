import Link from "next/link";
import React, {useState} from "react";
import NavItem from "@/app/components/navitem";
import SelectPlot, {SelectPlotProps} from "@/app/components/plotselection";

export interface PlotProps extends SelectPlotProps {}

const MENU_LIST = [
  {text: "Home", href: ""},
  {text: "Browse", href: "/browse"},
  {text: "Reporting", href: "/reporting"},
  {text: "Validation", href: "/validation"},
];

export default function NavBar({ plot, setPlot }: PlotProps){
  const [navActive, setNavActive] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  
  return (
    <header>
      <nav className={`nav`}>
        <div>
          <div onClick={() => setNavActive(!navActive)} className={`nav__menu-bar`}>
            <div></div>
            <div></div>
            <div></div>
          </div>
          <div className={`${navActive ? "active" : ""} nav__menu-list`}>
            <Link href={"/"} className={"logo"}>ForestGEO</Link>
            <SelectPlot plot={plot} setPlot={setPlot} />
            {MENU_LIST.map((menu, idx) => (
              <div
                onClick={() => {
                  setActiveIdx(idx);
                  setNavActive(false);
                }}
                key={menu.text}
              >
                <NavItem active={activeIdx === idx} {...menu} plotName={plot.key} />
              </div>
            ))}
          </div>
        </div>
      </nav>
    </header>
  );
}
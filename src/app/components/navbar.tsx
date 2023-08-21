"use client";
import Link from "next/link";
import Image from "next/image";
import React, { useState} from "react";
import NavItem from "@/app/components/navitem";

const MENU_LIST = [
    { text: "Home", href: "/" },
    { text: "Browse", href: "/browse"},
    { text: "Reporting", href: "/reporting" },
    { text: "Validation", href: "/validation" },
];

const NavBar = () => {
    const [navActive, setNavActive] = useState(false);
    const [activeIdx, setActiveIdx] = useState(-1);

    return (
        <header>
            <nav className={`nav`}>
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
            </nav>
        </header>
    );
}

export default NavBar;
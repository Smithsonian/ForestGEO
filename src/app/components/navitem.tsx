import Link from "next/link";

export interface NavProps {
    text: string,
    href: string,
    active: boolean,
    plotName: string,
};
// @ts-ignore
const NavItem = (props: NavProps) => {
    
    return (
        <Link href={`${props.href}/${props.plotName}`} className={`nav__link`}>{props.text}</Link>
    );
};

export default NavItem;
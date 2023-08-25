import Link from "next/link";

export interface NavProps {
    text: string,
    href: string,
    active: boolean
};
// @ts-ignore
const NavItem = ({ text, href, active }: NavProps) => {
    return (
        <Link href={href} className={`nav__link`}>{text}</Link>
    );
};

export default NavItem;
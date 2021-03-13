import { Link } from "react-router-dom";
import logo from "../assets/ForestGeoLogo.png";
import "./nav.css";

export const Nav = () => (
  <nav className="topnav">
    <img src={logo} alt="logo" width={"150"} className="logo"/>
    <ul>
      <li>
        <Link to="/">Home</Link>
      </li>
      <li>
        <Link to="/new">New plant form</Link>
      </li>
    </ul>
  </nav>
);

Nav.defaultName = 'Nav';
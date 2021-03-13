import {
    Link
  } from "react-router-dom";

export const Nav = () => (
    <nav>
        <ul>
          <li>
            <Link to="/">Home</Link>
          </li>
          <li>
            <Link to="/new">New plant form</Link>
          </li>
          <li>
            <Link to="/about">About</Link>
          </li>
        </ul>
    </nav>
);

Nav.defaultName = 'Nav';
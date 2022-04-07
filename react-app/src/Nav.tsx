import { Link, Outlet } from 'react-router-dom';

export default function Nav() {
  return (
    <div>
      <nav>
        <ul>
          <li>
            <Link to="/data-entry">Data Entry</Link>
          </li>
          <li>
            <Link to="/data-reports">Data Reports</Link>
          </li>
          <li>
            <Link to="/field-forms">Field Forms</Link>
          </li>
        </ul>
      </nav>
      <hr />
      <Outlet />
    </div>
  );
}

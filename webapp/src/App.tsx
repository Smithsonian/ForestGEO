import React from 'react';
import {
  BrowserRouter as Router
} from "react-router-dom";

import { Main} from './main';
import { Nav } from './nav';

function App() {
  return (
    <Router>
        <Nav />
        <Main />
    </Router>
  );
}

export default App;

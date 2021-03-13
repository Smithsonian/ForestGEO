import React from 'react';
import {
  BrowserRouter as Router
} from "react-router-dom";

import './App.css';

import { Main} from './main';
import { Nav } from './nav';

function App() {
  return (
    <Router>
      <div className="App">
        <Nav />
        <Main />
      </div>
    </Router>
  );
}

export default App;

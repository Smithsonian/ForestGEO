"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var react_1 = require("react");
var error_1 = require("@/app/error");
describe('Error Pages', function () {
    it('renders', function () {
        cy.mount(<error_1.default error={new Error('Test Error')} reset={function () { }}/>);
    });
});

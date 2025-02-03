import React from 'react'
import ErrorPage from '../../app/error'

describe('<ErrorPage />', () => {
  it('renders', () => {
    cy.mount(<ErrorPage />)
  })
})
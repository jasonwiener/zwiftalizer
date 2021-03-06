import React, {Component} from 'react'
import PropTypes from 'prop-types';
import {connect} from 'react-redux'
import structure from '../../styles/structure.css';
import Specs from './specs.jsx'
import {Chart} from './chart.jsx'
import Analysis from './analysis';

class Graphics extends React.Component {

  constructor(props) {
    super(props)
  }

  render() {
    const {isLoaded} = this.props
    return isLoaded
      ? this.renderChart()
      : null
  }

  renderChart() {

    // fpsData, fpsSamples, specs come from ...graphics spread operator
    const {fpsData, fpsSamples, specs} = this.props;

    const markup = fpsData && fpsData.size()
      ?  <Chart data={fpsData} samples={fpsSamples} specs={specs} />
      :  <div className="row" style={{height:"30rem"}}>
          <div className="col-sm-12">
            <h3 className={structure.sectionSubHeading}>No graphics performance data found</h3>
          </div>
        </div>;
    
  return (
      <div>
        <Specs specs={specs}/>
        {markup}
        <Analysis />        
      </div>
    )
  }
}

function mapStateToProps(state) {
  const {reader, graphics} = state
  return {
    ...reader,
    ...graphics
  }
}

Graphics.propTypes = {
  reader: PropTypes.object,
  graphics: PropTypes.object
}

export default connect(mapStateToProps)(Graphics)

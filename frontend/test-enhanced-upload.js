#!/usr/bin/env node

/**
 * Enhanced Upload System Test Runner (SAFE MODE)
 *
 * FIXED VERSION - Prevents computer crashes caused by endless spawn processes
 *
 * This version:
 * - Only runs safe unit tests (no Cypress e2e tests)
 * - Has proper process cleanup and timeouts
 * - Uses correct npm script references
 * - Includes memory limits and safety checks
 *
 * Previous version caused system crashes due to:
 * - Invalid npm script references (cypress:e2e, cypress:component)
 * - No process cleanup or timeouts
 * - Cascading spawn failures leading to pgrep process storms
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Enhanced Upload System Tests');
console.log('===============================================');

// Test configurations
const tests = [
  {
    name: 'Enhanced CSV Processing Unit Tests',
    command: 'test',
    args: ['tests/enhanced-csv-processing.test.ts'],
    description: 'Verifies core CSV processing functionality (SAFE)'
  }
];

async function runTest(test) {
  return new Promise((resolve, reject) => {
    console.log(`\n📋 Running: ${test.name}`);
    console.log(`   Description: ${test.description}`);
    console.log(`   Command: npm run ${test.command}`);

    // Add safety timeout and proper signal handling
    const testProcess = spawn('npm', ['run', test.command, ...(test.args || [])], {
      stdio: 'pipe',
      cwd: process.cwd(),
      timeout: 60000 // 60 second timeout
    });

    // Safety cleanup on process exit
    const cleanup = () => {
      if (testProcess && !testProcess.killed) {
        console.log(`\n⚠️  Cleaning up process for ${test.name}`);
        testProcess.kill('SIGKILL');
      }
    };

    process.on('exit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    let output = '';
    let errorOutput = '';
    let isResolved = false;

    // Add timeout handler
    const timeoutId = setTimeout(() => {
      if (!isResolved) {
        console.log(`\n⏰ ${test.name} - TIMEOUT (60s exceeded)`);
        cleanup();
        isResolved = true;
        resolve({ test, passed: false, error: 'Test timeout exceeded' });
      }
    }, 60000);

    testProcess.stdout.on('data', data => {
      const text = data.toString();
      output += text;
      // Limit output to prevent memory issues
      if (output.length > 50000) {
        output = output.slice(-25000); // Keep last 25KB
      }
    });

    testProcess.stderr.on('data', data => {
      const text = data.toString();
      errorOutput += text;
      if (errorOutput.length > 10000) {
        errorOutput = errorOutput.slice(-5000); // Keep last 5KB
      }
    });

    testProcess.on('close', code => {
      if (!isResolved) {
        clearTimeout(timeoutId);
        cleanup();
        isResolved = true;

        if (code === 0) {
          console.log(`✅ ${test.name} - PASSED`);
          resolve({ test, passed: true, output });
        } else {
          console.log(`❌ ${test.name} - FAILED (exit code: ${code})`);
          resolve({ test, passed: false, output, errorOutput });
        }
      }
    });

    testProcess.on('error', error => {
      if (!isResolved) {
        clearTimeout(timeoutId);
        cleanup();
        isResolved = true;
        console.log(`💥 ${test.name} - ERROR: ${error.message}`);
        resolve({ test, passed: false, error: error.message });
      }
    });
  });
}

async function runAllTests() {
  console.log(`\nRunning ${tests.length} test suites...\n`);

  const results = [];

  for (const test of tests) {
    const result = await runTest(test);
    results.push(result);
  }

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(50));

  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed);

  console.log(`✅ Passed: ${passed.length}`);
  console.log(`❌ Failed: ${failed.length}`);
  console.log(`📋 Total:  ${results.length}`);

  if (failed.length > 0) {
    console.log('\n🔍 Failed Tests:');
    failed.forEach(result => {
      console.log(`   - ${result.test.name}`);
    });
  }

  console.log('\n🎯 Enhanced Upload System Features Tested (SAFE MODE):');
  console.log('   • Header-order independence (cocoli1b.csv format)');
  console.log('   • Multi-format date parsing');
  console.log('   • Coordinate precision handling');
  console.log('   • Core CSV processing logic');
  console.log('   • Data transformation functions');
  console.log('   • Unit test validation only (no browser/e2e tests)');

  console.log('\n📝 Test Results Show:');
  if (passed.length === results.length) {
    console.log('   🎉 Core functionality verified!');
    console.log('   🔧 Enhanced CSV processing logic working');
    console.log('   ✅ Unit tests validate core fixes');
    console.log('   🚀 Safe to use enhanced upload system');
    console.log('   \n⚠️  Note: This runs SAFE unit tests only.');
    console.log('   💡 For full e2e testing, use: npm run test:e2e:ci');
  } else {
    console.log('   ⚠️  Some tests failed - review output above');
    console.log('   🔧 Core functionality may need attention');
  }

  return failed.length === 0;
}

// Check if npm test is available (safer than Cypress check)
const npmCheck = spawn('npm', ['run', 'test', '--help'], { stdio: 'pipe' });
npmCheck.on('close', code => {
  if (code !== 0) {
    console.log('❌ npm test not available. Please check package.json scripts.');
    process.exit(1);
  } else {
    console.log('✅ npm test available, running safe tests only...');
    runAllTests()
      .then(success => {
        process.exit(success ? 0 : 1);
      })
      .catch(error => {
        console.error('💥 Test runner crashed:', error.message);
        process.exit(1);
      });
  }
});

npmCheck.on('error', error => {
  console.log(`❌ npm not available: ${error.message}`);
  process.exit(1);
});

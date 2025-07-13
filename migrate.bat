@echo off
REM Database Migration Management Commands - Windows Version
REM Equivalent to Makefile commands for cross-platform compatibility

if "%1"=="" goto help

REM Phase 1 & 2 Commands
if "%1"=="validate-migrations" (
    echo 🔍 Validating migrations...
    cd backend && python scripts/validate_migrations.py --verbose
    goto end
)

if "%1"=="verify-db" (
    echo 🔍 Verifying database state...
    cd backend && python scripts/verify_database_state.py --verbose
    goto end
)

if "%1"=="test-migrations" (
    echo 🧪 Testing migrations...
    cd backend && python scripts/test_migrations.py
    goto end
)

if "%1"=="test-migrations-individual" (
    echo 🧪 Testing individual migrations...
    cd backend && python scripts/test_migrations.py --test-individual
    goto end
)

if "%1"=="migration-graph" (
    echo 📊 Migration dependency graph:
    cd backend && python scripts/validate_migrations.py --graph
    goto end
)

REM Phase 3 Commands (Testing & Monitoring)
if "%1"=="advanced-tests" (
    echo 🧪 Running advanced migration tests...
    cd backend && python scripts/advanced_migration_tests.py --verbose
    goto end
)

if "%1"=="performance-tests" (
    echo ⚡ Running performance tests...
    cd backend && python scripts/advanced_migration_tests.py --performance-only --verbose
    goto end
)

if "%1"=="monitor-health" (
    echo 🏥 Checking migration health...
    cd backend && python scripts/migration_monitor.py --verbose
    goto end
)

if "%1"=="monitor-continuous" (
    echo 🔄 Starting continuous monitoring...
    cd backend && python scripts/migration_monitor.py --continuous
    goto end
)

if "%1"=="recovery-status" (
    echo 📊 Migration recovery status...
    cd backend && python scripts/migration_recovery.py status
    goto end
)

if "%1"=="recovery-diagnose" (
    echo 🔍 Diagnosing migration issues...
    cd backend && python scripts/migration_recovery.py diagnose
    goto end
)

if "%1"=="emergency-backup" (
    echo 💾 Creating emergency backup...
    for /f "tokens=2 delims==" %%I in ('wmic OS Get localdatetime /value') do set datetime=%%I
    set backup_name=emergency_%datetime:~0,8%_%datetime:~8,6%
    cd backend && python scripts/migration_recovery.py backup --name %backup_name%
    goto end
)

if "%1"=="list-backups" (
    echo 📦 Available backups:
    cd backend && python scripts/migration_recovery.py list-backups
    goto end
)

if "%1"=="validate-recovery" (
    echo ✅ Validating recovery state...
    cd backend && python scripts/migration_recovery.py validate
    goto end
)

REM Migration Management Commands
if "%1"=="fix-migration-conflict" (
    echo 🔧 Applying migration conflict fix...
    echo ⚠️  Make sure you have a database backup!
    set /p confirm="Continue? (y/N): "
    if /i "%confirm%"=="y" (
        cd backend
        alembic upgrade head
        cd ..
    ) else (
        echo Operation cancelled.
    )
    goto end
)

if "%1"=="new-migration" (
    echo 📝 Creating new migration...
    set /p desc="Migration description: "
    cd backend
    alembic revision --autogenerate -m "%desc%"
    echo ✅ Migration created. Running validation...
    python scripts/validate_migrations.py
    cd ..
    goto end
)

if "%1"=="setup-hooks" (
    echo 🔧 Setting up pre-commit hooks...
    pip install pre-commit
    pre-commit install
    echo ✅ Pre-commit hooks installed
    goto end
)

REM Emergency Commands
if "%1"=="reset-migrations" (
    echo ⚠️  WARNING: This will reset all migrations!
    echo ⚠️  Only use in development with backed up data!
    set /p confirm="Are you absolutely sure? Type 'RESET' to continue: "
    if "%confirm%"=="RESET" (
        cd backend
        del /q migrations\versions\*.py
        alembic revision --autogenerate -m "reset_baseline"
        echo ✅ Migrations reset. Review the new baseline migration before applying.
        cd ..
    ) else (
        echo Operation cancelled.
    )
    goto end
)

if "%1"=="help" goto help

echo Unknown command: %1
echo Run 'migrate.bat help' for available commands.
goto end

:help
echo Database Migration Management Commands - Windows Version
echo.
echo Phase 1 ^& 2 Commands:
echo   validate-migrations     - Check for migration conflicts
echo   verify-db              - Verify database matches models
echo   test-migrations        - Test migration up/down cycle
echo   test-migrations-individual - Test each migration individually
echo   migration-graph        - Show migration dependency graph
echo   fix-migration-conflict - Apply fix for current conflict
echo   new-migration          - Create new migration with validation
echo   setup-hooks           - Install pre-commit hooks
echo.
echo Phase 3 Commands (Testing ^& Monitoring):
echo   advanced-tests         - Run comprehensive migration tests
echo   performance-tests      - Run migration performance tests
echo   monitor-health         - Check migration system health
echo   monitor-continuous     - Start continuous health monitoring
echo   recovery-status        - Show migration recovery status
echo   recovery-diagnose      - Diagnose migration issues
echo   emergency-backup       - Create emergency database backup
echo   list-backups          - List available backups
echo   validate-recovery      - Validate recovery state
echo.
echo Emergency Commands:
echo   reset-migrations      - Reset all migrations (DANGEROUS)
echo   help                  - Show this help
echo.
echo Usage: migrate.bat [command]
echo Example: migrate.bat monitor-health

:end
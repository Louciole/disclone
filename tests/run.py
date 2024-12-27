import os
import importlib
from colorama import Fore, Style, init

def run_file(file_path):
    """Runs a single Python test file."""
    # Extract the module name from the file path
    module_name = os.path.splitext(os.path.relpath(file_path, "tests"))[0].replace("/", ".")
    readable_path = file_path.strip(test_dir)

    # Import the test module
    try:
        test_module = importlib.import_module(f"{module_name}", package=None)
    except ModuleNotFoundError as e:
        print(f"Failed to import test module '{module_name}': {e}")
        return False

    # Look for a 'run' function within the module (assuming tests are run from this function)
    if hasattr(test_module, 'run'):
        try:
            result = test_module.run()
            for res in result:
                if res[1] == False:
                    print(Fore.RED +f"FAILED: '{res[0]}' @{readable_path}")
                    return False
                else:
                    print(Fore.GREEN +f"PASSED: '{res[0]}' @{readable_path}")
                    return True
        except Exception as e:
            print(f"Error running test file '{readable_path}': {e}")
    else:
        print(f"Test file '{readable_path}' doesn't have a 'run' function.")

    return False


def run_folder(folder):
    """Runs all Python test files in a directory."""
    counter = (0,0)

    for root, _, files in os.walk(folder):
        for file in files:
            if file.endswith('.py'):
                file_path = os.path.join(root, file)
                res = run_file(file_path)
                if res == True:
                    counter = (counter[0]+1,counter[1]+1)
                elif res == False:
                    counter = (counter[0],counter[1]+1)

    return counter

test_dir = "./tests"

if __name__ == "__main__":
    init()# Initialize colorama

    counter = 0
    total = 0

    for _, dirs, _ in os.walk(test_dir):
        for folder in dirs:
            if folder == '__pycache__':
                continue
            print("Running folder "+folder)
            count = run_folder(test_dir+'/'+folder)
            counter += count[0]
            total += count[1]

    if counter == total:
        color = Fore.GREEN
        exCode = 0
    else:
        color = Fore.RED
        exCode = 1
    print(color + f"{counter}/{total} tests passed")
    exit(exCode)
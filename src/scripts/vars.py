import gdb
import sys
import json


class ListVariablesCommand(gdb.Command):
    """Lists all variables in the current context and print JSON."""

    def __init__(self):
        super(ListVariablesCommand, self).__init__("info context",
                                                   gdb.COMMAND_STACK,
                                                   gdb.COMPLETE_NONE,
                                                   True)

    def invoke(self, arg, from_tty):
        frame = gdb.selected_frame()
        block = frame.block()
        variables = []
        while block:
            for symbol in block:
                if (symbol.is_argument or symbol.is_variable):
                    scope = 'global' if block.is_global else \
                            'static' if block.is_static else \
                            'arg' if symbol.is_argument else 'local'
                    variables.append({
                        'name': symbol.name,
                        'value': str(symbol.value(frame)),
                        'type': str(symbol.type),
                        'scope': scope
                    })
            block = block.superblock
        sys.stdout.write(json.dumps(variables))

ListVariablesCommand()


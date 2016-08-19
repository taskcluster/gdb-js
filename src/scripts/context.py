import gdb


class ContextCommand(BaseCommand):
    """Lists all symbols in the current context."""

    def __init__(self):
        super(ContextCommand, self).__init__("context")

    def action(self, arg, from_tty):
        frame = gdb.selected_frame()
        block = frame.block()
        names = set()
        variables = []
        while block:
            for symbol in block:
                name = symbol.name
                if (name not in names) and (symbol.is_argument or
                   symbol.is_variable or symbol.is_function or
                   symbol.is_constant):
                    scope = "global" if block.is_global else \
                            "static" if block.is_static else \
                            "argument" if symbol.is_argument else \
                            "local"
                    names.add(name)
                    variables.append({
                        "name": symbol.name,
                        "value": str(symbol.value(frame)),
                        "type": str(symbol.type),
                        "scope": scope
                    })
            block = block.superblock
        return variables

gdbjsContext = ContextCommand()
